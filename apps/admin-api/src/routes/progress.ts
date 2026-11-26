import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type CertificateRef,
  type CourseStudent,
  type Database,
  getCertificateRefs,
  getCourseProgressSummary,
  getUserProgress,
  listCourseStudents,
  type ProgressCounts,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { type IdParams, isoOrNull } from './catalog-common.ts';

// Progresso para a equipe (spec 014, "Para a equipe"): progresso de um usuário, resumo do curso
// por faixa e alunos do curso. O tratador de `sessionCookie` confere `progress.view` de
// `x-permission`; o núcleo confere de novo e aplica o alcance do instrutor (só os próprios
// cursos; fora dele, `404`). Nenhuma rota lê anotações do aluno (spec 014, "Anotações"). Aqui só
// transporte.

export interface ProgressRoutesOptions {
  db: Database;
}

/** `ProgressCounts` do contrato. */
function countsBody(progress: ProgressCounts) {
  return {
    completedLessons: progress.completedLessons,
    totalLessons: progress.totalLessons,
    percent: progress.percent,
    state: progress.state,
  };
}

/** `CertificateRef` do contrato. */
function certificateRefBody(ref: CertificateRef | undefined) {
  return ref === undefined ? null : { id: ref.id, code: ref.code, state: ref.state };
}

/** `CourseStudent` do contrato: nome e avatar, sem e-mail nem compras. */
function studentBody(student: CourseStudent) {
  return {
    user: { id: student.user.id, name: student.user.name, avatarUrl: student.user.avatarUrl },
    progress: countsBody(student.progress),
    lastActivityAt: isoOrNull(student.lastActivityAt),
    accessExpiresAt: isoOrNull(student.accessExpiresAt),
  };
}

export function registerProgressRoutes(app: FastifyInstance, options: ProgressRoutesOptions): void {
  const { db } = options;

  // `GET /api/v1/users/{id}/progress`: um item por curso, com o certificado de cada um.
  app.operation('getUserProgress', async (request) => {
    const { id } = request.params as IdParams;
    const progress = await getUserProgress(db, managementRequest(request), id);
    // O alcance já foi conferido pela leitura do progresso: só os cursos devolvidos.
    const refs = await getCertificateRefs(
      db,
      id,
      progress.items.map((item) => item.course.id),
    );
    return {
      items: progress.items.map((item) => ({
        course: { type: item.course.type, id: item.course.id, title: item.course.title },
        progress: countsBody(item.progress),
        lastActivityAt: isoOrNull(item.lastActivityAt),
        certificate: certificateRefBody(refs.get(item.course.id)),
      })),
    };
  });

  // `GET /api/v1/courses/{id}/progress-summary`.
  app.operation('getCourseProgressSummary', async (request) => {
    const { id } = request.params as IdParams;
    const summary = await getCourseProgressSummary(db, managementRequest(request), id);
    return {
      courseId: summary.courseId,
      totalLessons: summary.totalLessons,
      studentCount: summary.studentCount,
      buckets: { ...summary.buckets },
      completionRate: summary.completionRate,
    };
  });

  // `GET /api/v1/courses/{id}/students`: a lista de alunos do instrutor, só nos próprios cursos.
  app.operation('listCourseStudents', async (request) => {
    const { id } = request.params as IdParams;
    const query = request.query as {
      q?: string;
      state?: string;
      sort?: string;
      limit?: number;
      cursor?: string;
    };
    const page = await listCourseStudents(db, managementRequest(request), id, query);
    return { items: page.items.map(studentBody), nextCursor: page.nextCursor };
  });
}
