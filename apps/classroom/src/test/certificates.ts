import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { COURSE_ITEM } from './catalog';

type MyCertificate = ClassroomSchemas['MyCertificate'];
type CertificateVerification = ClassroomSchemas['CertificateVerification'];
type CourseCertificateState = ClassroomSchemas['CourseCertificateState'];

const id = (suffix: string) => `0193a5b2-0000-7000-8000-0000000${suffix}`;

export const CERTIFICATE_ID = id('0000f1');
export const CERTIFICATE_CODE = 'ABCD-EFGH-JKMN';

/** Um certificado da aluna (esquema `MyCertificate`); por padrão, `React do zero` emitido. */
export function makeMyCertificate(overrides: Partial<MyCertificate> = {}): MyCertificate {
  return {
    id: CERTIFICATE_ID,
    code: CERTIFICATE_CODE,
    state: 'issued',
    course: { id: COURSE_ITEM.id, slug: COURSE_ITEM.slug, title: COURSE_ITEM.title },
    courseTitle: COURSE_ITEM.title,
    studentName: 'Ana Souza Lima',
    hours: 12,
    completedAt: '2026-11-20T15:00:00Z',
    issuedAt: '2026-11-20T15:01:00Z',
    revokedAt: null,
    validationUrl: `https://classroom.escola.test/certificados/${CERTIFICATE_CODE}`,
    ...overrides,
  };
}

/** `GET /me/certificates`: um emitido, um em preparação, um revogado e um aguardando template. */
export const MY_CERTIFICATES: ClassroomSchemas['MyCertificates'] = {
  studentName: 'Ana Souza Lima',
  items: [
    makeMyCertificate(),
    makeMyCertificate({
      id: id('0000f2'),
      code: 'PQRS-TUVW-XYZ2',
      state: 'preparing',
      course: { id: id('0000c2'), slug: 'node-na-pratica', title: 'Node na prática' },
      courseTitle: 'Node na prática',
      hours: 1,
    }),
    makeMyCertificate({
      id: id('0000f3'),
      code: 'HJKM-NPQR-STUV',
      state: 'revoked',
      course: { id: id('0000c4'), slug: 'git-essencial', title: 'Git essencial' },
      courseTitle: 'Git essencial',
      revokedAt: '2026-11-22T12:00:00Z',
    }),
  ],
  awaitingTemplate: [
    {
      course: { id: id('0000c3'), slug: 'css-moderno', title: 'CSS moderno' },
      completedAt: '2026-11-10T12:00:00Z',
    },
  ],
};

/** Estado do certificado de um curso (esquema `CourseCertificateState`). */
export function makeCourseCertificate(
  overrides: Partial<CourseCertificateState> = {},
): CourseCertificateState {
  return {
    state: 'in_progress',
    certificateId: null,
    code: null,
    studentName: 'Ana Souza',
    ...overrides,
  };
}

export const ISSUED_COURSE_CERTIFICATE = makeCourseCertificate({
  state: 'issued',
  certificateId: CERTIFICATE_ID,
  code: CERTIFICATE_CODE,
  studentName: 'Ana Souza Lima',
});

/** Validação pública de um certificado válido (esquema `CertificateVerification`). */
export const VALID_VERIFICATION: CertificateVerification = {
  status: 'valid',
  code: CERTIFICATE_CODE,
  studentName: 'Ana Souza Lima',
  courseTitle: 'React do zero',
  hours: 12,
  completedAt: '2026-11-20T15:00:00Z',
  issuedAt: '2026-11-20T15:01:00Z',
  schoolName: 'Escola Aurora',
  revokedAt: null,
};

export const REVOKED_VERIFICATION: CertificateVerification = {
  status: 'revoked',
  code: CERTIFICATE_CODE,
  studentName: null,
  courseTitle: null,
  hours: null,
  completedAt: null,
  issuedAt: null,
  schoolName: null,
  revokedAt: '2026-11-22T12:00:00Z',
};

export const REMOVED_VERIFICATION: CertificateVerification = {
  status: 'holder_removed',
  code: CERTIFICATE_CODE,
  studentName: null,
  courseTitle: 'React do zero',
  hours: null,
  completedAt: '2026-11-20T15:00:00Z',
  issuedAt: '2026-11-20T15:01:00Z',
  schoolName: null,
  revokedAt: null,
};

/** O PDF que a API devolve. */
export function pdfResponse(): Response {
  return new Response('%PDF-1.7 certificado', {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'X-Request-Id': 'req-teste-1' },
  });
}
