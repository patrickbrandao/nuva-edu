// Certificados do lado do aluno e a validação pública (spec 015, "Estado do certificado para o
// aluno", "Validação pública" e RF-04; tarefa 415). Leituras do classroom-api, mais a gravação do
// nome que sai no certificado (`PUT /me/certificate-name`). Nunca expõe e-mail, foto nem perfil
// do titular na validação, e nunca lê a coluna `pdf` fora das funções de download.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { DomainError, notFound, validationFailed } from '../../errors/domain-error.ts';
import { FULL_NAME_MAX_LENGTH } from '../accounts/management/staff.ts';
import type { CatalogViewer } from '../catalog/classroom.ts';
import { decideAccess, getEntitlementStatuses } from '../entitlements/access.ts';
import { isUuid } from '../entitlements/types.ts';
import { normalizeCertificateCode } from './code.ts';
import {
  type CertificatePdfFile,
  type CertificateState,
  certificatePdfFilename,
  certificatePreparing,
  certificateStateOf,
  certificateStudentName,
} from './common.ts';
import { certificateValidationUrl, formatCertificateCode } from './template/values.ts';

/** O aluno da sessão do classroom, com o papel lido nesta requisição. */
export type CertificateViewer = CatalogViewer;

export const COURSE_CERTIFICATE_STATES = [
  'in_progress',
  'awaiting_template',
  'preparing',
  'issued',
  'revoked',
] as const;
/** Estado do certificado de um curso para o aluno (`CourseCertificateStateName` do contrato). */
export type CourseCertificateStateName = (typeof COURSE_CERTIFICATE_STATES)[number];

/** `CourseCertificateState` do contrato; `null` nos campos que o usam: certificado desabilitado. */
export interface CourseCertificateState {
  state: CourseCertificateStateName;
  /** Presente quando o certificado existe. */
  certificateId: string | null;
  /** Com hífens, em `issued` e `revoked`. */
  code: string | null;
  /** O nome que sairá no certificado; o congelado, quando ele já existe. */
  studentName: string;
}

/** Um curso cujo estado é pedido, com o que o chamador já leu dele. */
export interface CertificateStateCourse {
  id: string;
  certificateEnabled: boolean;
  /** 100% das aulas publicadas concluídas, pelo progresso que a página já mostra (spec 014). */
  completed: boolean;
}

interface StateFacts {
  studentName: string;
  certificates: Map<
    string,
    {
      id: string;
      code: string;
      studentName: string | null;
      revokedAt: Date | null;
      pdfRenderedAt: Date | null;
    }
  >;
  /** Cursos com template próprio. */
  ownTemplates: Set<string>;
  schoolTemplate: boolean;
}

/** Nome do aluno, certificados e templates dos cursos pedidos: 2 consultas, qualquer número de cursos. */
async function loadStateFacts(
  db: Database,
  userId: string,
  courseIds: readonly string[],
): Promise<StateFacts> {
  const user = await db
    .selectFrom('users')
    .select(['name', 'fullName'])
    .where('id', '=', userId)
    .executeTakeFirst();
  const facts: StateFacts = {
    studentName: user ? certificateStudentName(user) : '',
    certificates: new Map(),
    ownTemplates: new Set(),
    schoolTemplate: false,
  };
  if (courseIds.length === 0) return facts;
  const result = await sql<{
    kind: 'certificate' | 'template';
    courseId: string | null;
    id: string;
    code: string | null;
    studentName: string | null;
    revokedAt: Date | null;
    pdfRenderedAt: Date | null;
  }>`
    SELECT 'certificate' AS kind, c.course_id, c.id, c.code, c.student_name, c.revoked_at,
           c.pdf_rendered_at
      FROM certificates c
     WHERE c.user_id = ${userId}::uuid AND c.course_id = ANY(${courseIds}::uuid[])
    UNION ALL
    SELECT 'template', t.course_id, t.id, NULL, NULL, NULL, NULL
      FROM certificate_templates t
     WHERE t.course_id IS NULL OR t.course_id = ANY(${courseIds}::uuid[])`.execute(db);
  for (const row of result.rows) {
    if (row.kind === 'template') {
      if (row.courseId === null) facts.schoolTemplate = true;
      else facts.ownTemplates.add(row.courseId);
    } else if (row.courseId !== null && row.code !== null) {
      facts.certificates.set(row.courseId, {
        id: row.id,
        code: row.code,
        studentName: row.studentName,
        revokedAt: row.revokedAt,
        pdfRenderedAt: row.pdfRenderedAt,
      });
    }
  }
  return facts;
}

function stateOf(course: CertificateStateCourse, facts: StateFacts): CourseCertificateState | null {
  if (!course.certificateEnabled) return null;
  const certificate = facts.certificates.get(course.id);
  if (certificate) {
    // Emitido (manual ou já existente) vale mesmo com o curso abaixo de 100% (spec 015).
    const state: CertificateState = certificateStateOf(certificate);
    return {
      state,
      certificateId: certificate.id,
      code: state === 'preparing' ? null : formatCertificateCode(certificate.code),
      studentName: certificate.studentName ?? facts.studentName,
    };
  }
  const hasTemplate = facts.schoolTemplate || facts.ownTemplates.has(course.id);
  return {
    state: course.completed && !hasTemplate ? 'awaiting_template' : 'in_progress',
    certificateId: null,
    code: null,
    studentName: facts.studentName,
  };
}

/**
 * O estado do certificado de vários cursos para o aluno (estante, `GET /me/courses`), em 2
 * consultas, sem consulta por curso. Curso com certificado desabilitado: `null`. Com certificado:
 * `preparing`, `issued` ou `revoked`, mesmo que o curso tenha voltado a menos de 100%. Sem
 * certificado: `awaiting_template` com 100% e sem template efetivo; senão `in_progress` (com 100%
 * e template, a emissão está a caminho; a tela mostra "ao concluir" até o registro existir).
 */
export async function getCourseCertificateStates(
  db: Database,
  viewer: CertificateViewer,
  courses: readonly CertificateStateCourse[],
): Promise<Map<string, CourseCertificateState | null>> {
  const states = new Map<string, CourseCertificateState | null>();
  const valid = courses.filter((course) => isUuid(course.id));
  for (const course of courses) states.set(course.id, null);
  if (!isUuid(viewer.id) || !valid.some((course) => course.certificateEnabled)) return states;
  const userId = viewer.id.toLowerCase();
  const enabledIds = [
    ...new Set(
      valid.filter((course) => course.certificateEnabled).map((course) => course.id.toLowerCase()),
    ),
  ];
  const facts = await loadStateFacts(db, userId, enabledIds);
  for (const course of valid) {
    states.set(course.id, stateOf({ ...course, id: course.id.toLowerCase() }, facts));
  }
  return states;
}

/** O estado do certificado de um curso (`GET /courses/{slug}`); `null` com certificado desabilitado. */
export async function getCourseCertificateState(
  db: Database,
  viewer: CertificateViewer,
  course: CertificateStateCourse,
): Promise<CourseCertificateState | null> {
  const states = await getCourseCertificateStates(db, viewer, [course]);
  return states.get(course.id) ?? null;
}

// `GET /me/certificates`.

/** Um curso citado no classroom. */
export interface CertificateCourseRef {
  id: string;
  slug: string;
  /** O título atual. */
  title: string;
}

/** `MyCertificate` do contrato. */
export interface MyCertificate {
  id: string;
  /** Com hífens. */
  code: string;
  state: CertificateState;
  course: CertificateCourseRef;
  /** Congelado na emissão. */
  courseTitle: string;
  /** Congelado na emissão. */
  studentName: string;
  hours: number;
  completedAt: Date;
  issuedAt: Date;
  revokedAt: Date | null;
  /** `https://<NUVA_CLASSROOM_HOST>/certificados/<código>`. */
  validationUrl: string;
}

/** `AwaitingCertificate` do contrato. */
export interface AwaitingCertificate {
  course: CertificateCourseRef;
  /** Conclusão da última aula. */
  completedAt: Date;
}

/** `MyCertificates` do contrato. */
export interface MyCertificates {
  /** O nome que sairá nos próximos certificados. */
  studentName: string;
  items: MyCertificate[];
  awaitingTemplate: AwaitingCertificate[];
}

interface AwaitingRow {
  id: string;
  slug: string;
  title: string;
  accessMode: 'open' | 'paid' | 'private';
  ownerId: string | null;
  completedAt: Date;
}

/**
 * Cursos publicados, com certificado habilitado, sem template efetivo e sem certificado do
 * usuário, em que ele concluiu 100% das aulas publicadas e tem acesso (a regra de `canAccess`,
 * com os direitos lidos em lote). 2 consultas.
 */
async function listAwaitingTemplate(
  db: Database,
  viewer: { id: string; role: CertificateViewer['role'] },
): Promise<AwaitingCertificate[]> {
  const result = await sql<AwaitingRow>`
    WITH done AS (
      SELECT lp.course_id, count(*)::int AS completed, max(lp.completed_at) AS completed_at
        FROM lesson_progress lp
        JOIN lessons l ON l.id = lp.lesson_id AND l.status = 'published'
       WHERE lp.user_id = ${viewer.id}::uuid AND lp.completed_at IS NOT NULL
       GROUP BY lp.course_id
    )
    SELECT c.id, c.slug, c.title, c.access_mode, c.owner_id, done.completed_at
      FROM done
      JOIN courses c ON c.id = done.course_id
     WHERE c.certificate_enabled AND c.status = 'published' AND c.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM certificate_templates t
                        WHERE t.course_id = c.id OR t.course_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM certificates x
                        WHERE x.user_id = ${viewer.id}::uuid AND x.course_id = c.id)
       AND done.completed >= (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                               WHERE m.course_id = c.id AND l.status = 'published')
     ORDER BY done.completed_at DESC, c.id`.execute(db);
  if (result.rows.length === 0) return [];
  const statuses = await getEntitlementStatuses(db, viewer.id, {
    productType: 'course',
    productIds: result.rows.map((row) => row.id),
  });
  return result.rows
    .filter(
      (row) =>
        decideAccess({
          target: 'course',
          user: { id: viewer.id, role: viewer.role, suspended: false },
          published: true,
          accessMode: row.accessMode,
          ownerId: row.ownerId,
          entitlement: statuses.get(row.id) ?? { state: 'none' },
        }).allowed,
    )
    .map((row) => ({
      course: { id: row.id, slug: row.slug, title: row.title },
      completedAt: row.completedAt,
    }));
}

/**
 * `GET /me/certificates`: os certificados do aluno (todos os estados, mais recentes primeiro),
 * o nome que sairá nos próximos e, à parte, os cursos concluídos que aguardam template. 4
 * consultas. `classroomUrl` (`Config.classroomUrl`) monta a URL de validação.
 */
export async function listMyCertificates(
  db: Database,
  viewer: CertificateViewer,
  options: { classroomUrl: string },
): Promise<MyCertificates> {
  if (!isUuid(viewer.id)) return { studentName: '', items: [], awaitingTemplate: [] };
  const userId = viewer.id.toLowerCase();
  const user = await db
    .selectFrom('users')
    .select(['name', 'fullName'])
    .where('id', '=', userId)
    .executeTakeFirst();
  const studentName = user ? certificateStudentName(user) : '';
  const rows = await db
    .selectFrom('certificates as c')
    .innerJoin('courses as co', 'co.id', 'c.courseId')
    .select([
      'c.id',
      'c.code',
      'c.studentName',
      'c.courseTitle',
      'c.hours',
      'c.completedAt',
      'c.issuedAt',
      'c.revokedAt',
      'c.pdfRenderedAt',
      'co.id as courseId',
      'co.slug as courseSlug',
      'co.title as currentCourseTitle',
    ])
    .where('c.userId', '=', userId)
    .orderBy('c.issuedAt', 'desc')
    .orderBy('c.id', 'desc')
    .execute();
  const items = rows.map(
    (row): MyCertificate => ({
      id: row.id,
      code: formatCertificateCode(row.code),
      state: certificateStateOf(row),
      course: { id: row.courseId, slug: row.courseSlug, title: row.currentCourseTitle },
      courseTitle: row.courseTitle,
      studentName: row.studentName ?? studentName,
      hours: row.hours,
      completedAt: row.completedAt,
      issuedAt: row.issuedAt,
      revokedAt: row.revokedAt,
      validationUrl: certificateValidationUrl(options.classroomUrl, row.code),
    }),
  );
  const awaitingTemplate = await listAwaitingTemplate(db, { id: userId, role: viewer.role });
  return { studentName, items, awaitingTemplate };
}

/**
 * `GET /me/certificates/{id}/pdf`: o PDF, só para o dono. De outro aluno, inexistente, revogado
 * (o aluno deixa de baixá-lo) ou sem PDF pela exclusão da conta: `404`. PDF ainda não gerado:
 * `409` `certificate_preparing`.
 */
export async function getMyCertificatePdf(
  db: Database,
  viewer: CertificateViewer,
  certificateId: unknown,
): Promise<CertificatePdfFile> {
  const row =
    isUuid(certificateId) && isUuid(viewer.id)
      ? await db
          .selectFrom('certificates')
          .select(['code', 'pdf', 'studentName', 'revokedAt'])
          .where('id', '=', certificateId.toLowerCase())
          .where('userId', '=', viewer.id.toLowerCase())
          .executeTakeFirst()
      : undefined;
  if (!row || row.revokedAt !== null || row.studentName === null) {
    throw notFound('Certificado não encontrado.');
  }
  if (row.pdf === null) throw certificatePreparing();
  return { pdf: row.pdf, filename: certificatePdfFilename(row.code) };
}

// `PUT /me/certificate-name`.

/** `CertificateName` do contrato. */
export interface CertificateName {
  fullName: string | null;
  /** O nome que sairá no certificado: o completo ou, sem ele, o de exibição. */
  studentName: string;
}

/**
 * `PUT /me/certificate-name`: grava `users.full_name`, o nome dos próximos certificados (sem
 * espera de confirmação, ADR 0026). `null` apaga, e vale o nome de exibição. De 1 a 160
 * caracteres, sem os espaços das pontas; fora disso, `400`. Certificado emitido não muda (a
 * correção é a reemissão). Conta inexistente ou excluída: `404`.
 */
export async function setCertificateName(
  db: Database,
  viewer: CertificateViewer,
  input: { fullName: unknown },
): Promise<CertificateName> {
  let fullName: string | null;
  if (input.fullName === null) {
    fullName = null;
  } else {
    const text = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    const length = [...text].length;
    if (length < 1 || length > FULL_NAME_MAX_LENGTH) {
      throw validationFailed([
        {
          path: 'body.fullName',
          message: `Use de 1 a ${FULL_NAME_MAX_LENGTH} caracteres, ou null.`,
        },
      ]);
    }
    fullName = text;
  }
  const row = isUuid(viewer.id)
    ? await db
        .updateTable('users')
        .set({ fullName, version: sql<number>`version + 1`, updatedAt: sql<Date>`now()` })
        .where('id', '=', viewer.id.toLowerCase())
        .where('deletedAt', 'is', null)
        .returning(['name', 'fullName'])
        .executeTakeFirst()
    : undefined;
  if (!row) throw notFound('Usuário não encontrado.');
  return { fullName: row.fullName, studentName: certificateStudentName(row) };
}

// Validação pública.

export const CERTIFICATE_VERIFICATION_STATUSES = ['valid', 'revoked', 'holder_removed'] as const;
export type CertificateVerificationStatus = (typeof CERTIFICATE_VERIFICATION_STATUSES)[number];

/**
 * `CertificateVerification` do contrato. Cada campo só vem no estado que o prevê; nos demais é
 * `null`. Nunca traz e-mail, foto, perfil, motivo de revogação nem o PDF.
 */
export interface CertificateVerification {
  status: CertificateVerificationStatus;
  /** Com hífens. */
  code: string;
  /** Só em `valid`. */
  studentName: string | null;
  /** Em `valid` e `holder_removed`. */
  courseTitle: string | null;
  /** Só em `valid`. */
  hours: number | null;
  /** Em `valid` e `holder_removed`. */
  completedAt: Date | null;
  /** Em `valid` e `holder_removed`. */
  issuedAt: Date | null;
  /** Só em `valid`. */
  schoolName: string | null;
  /** Só em `revoked`. */
  revokedAt: Date | null;
}

/** Procurado no lugar de um código fora do formato: nunca existe (o CHECK recusa `0`). */
const IMPOSSIBLE_CODE = '000000000000';

/** `404` `certificate_not_found`: igual para qualquer código inexistente ou fora do formato. */
export function certificateNotFound(): DomainError {
  return new DomainError({
    code: 'certificate_not_found',
    status: 404,
    title: 'Certificado não encontrado',
  });
}

/**
 * `GET /certificates/verify/{code}` (público, sem login): aceita o código com ou sem hífens e em
 * minúsculas. Inexistente ou fora do formato: `404` `certificate_not_found`, com a mesma
 * resposta e a mesma consulta (o código fora do formato também vai ao banco, e o tempo não
 * revela a diferença). Revogado: só o estado, o código e a data da revogação. Titular que excluiu
 * a conta: o código, o curso e as datas, sem o nome. Uma consulta pelo índice do código.
 */
export async function verifyCertificate(
  db: Database,
  code: unknown,
): Promise<CertificateVerification> {
  const normalized = normalizeCertificateCode(code);
  const row = await db
    .selectFrom('certificates')
    .select([
      'code',
      'studentName',
      'courseTitle',
      'hours',
      'completedAt',
      'issuedAt',
      'schoolName',
      'revokedAt',
    ])
    .where('code', '=', normalized ?? IMPOSSIBLE_CODE)
    .executeTakeFirst();
  if (!row || normalized === null) throw certificateNotFound();
  const base: CertificateVerification = {
    status: 'valid',
    code: formatCertificateCode(row.code),
    studentName: null,
    courseTitle: null,
    hours: null,
    completedAt: null,
    issuedAt: null,
    schoolName: null,
    revokedAt: null,
  };
  if (row.revokedAt !== null) return { ...base, status: 'revoked', revokedAt: row.revokedAt };
  if (row.studentName === null) {
    return {
      ...base,
      status: 'holder_removed',
      courseTitle: row.courseTitle,
      completedAt: row.completedAt,
      issuedAt: row.issuedAt,
    };
  }
  return {
    ...base,
    studentName: row.studentName,
    courseTitle: row.courseTitle,
    hours: row.hours,
    completedAt: row.completedAt,
    issuedAt: row.issuedAt,
    schoolName: row.schoolName,
  };
}
