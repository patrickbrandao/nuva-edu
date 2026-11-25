import { describe, expect, it } from 'vitest';
import { LESSON_1, LESSON_2, LESSON_3, MODULE_1, MODULE_2, makeCourseView } from '../test/learning';
import { applyCompletion, applyProgressResult, orderedModules, shiftCounts } from './progress';

const moduleOf = (course: ReturnType<typeof makeCourseView>, id: string) => {
  const found = course.modules.find((module) => module.id === id);
  if (!found) throw new Error(`módulo ${id} ausente`);
  return found;
};

describe('progresso otimista', () => {
  it('ordena módulos e aulas por `position`', () => {
    const modules = orderedModules(makeCourseView());
    expect(modules.map((module) => module.id)).toEqual([MODULE_1, MODULE_2]);
    expect(modules[0]?.lessons.map((lesson) => lesson.id)).toEqual([LESSON_1, LESSON_2]);
  });

  it('soma e tira uma aula, com percentual e estado', () => {
    const start = {
      completedLessons: 0,
      totalLessons: 3,
      percent: 0,
      state: 'not_started',
    } as const;
    const one = shiftCounts(start, 1);
    expect(one).toEqual({
      completedLessons: 1,
      totalLessons: 3,
      percent: 33,
      state: 'in_progress',
    });
    const all = shiftCounts(shiftCounts(one, 1), 1);
    expect(all).toMatchObject({ completedLessons: 3, percent: 100, state: 'completed' });
    // não passa do total nem fica negativo
    expect(shiftCounts(all, 1).completedLessons).toBe(3);
    expect(shiftCounts(start, -1).completedLessons).toBe(0);
    // desmarcar a única concluída: o curso já foi aberto, segue "em andamento"
    expect(shiftCounts(one, -1)).toMatchObject({ completedLessons: 0, state: 'in_progress' });
  });

  it('marca a aula e atualiza só o módulo dela e o curso', () => {
    const course = makeCourseView();
    const next = applyCompletion(course, LESSON_1, true);
    expect(next.progress).toMatchObject({ completedLessons: 1, percent: 33 });
    expect(moduleOf(next, MODULE_1).progress).toMatchObject({ completedLessons: 1, percent: 50 });
    expect(moduleOf(next, MODULE_2)).toBe(moduleOf(course, MODULE_2));
    expect(moduleOf(next, MODULE_1).lessons.map((lesson) => [lesson.id, lesson.completed])).toEqual(
      [
        [LESSON_2, false],
        [LESSON_1, true],
      ],
    );
    // repetir é idempotente; aula de fora do curso não muda nada
    expect(applyCompletion(next, LESSON_1, true)).toBe(next);
    expect(applyCompletion(course, 'outra-aula', true)).toBe(course);
    expect(applyCompletion(next, LESSON_1, false).progress.completedLessons).toBe(0);
  });

  it('sem o curso, a amostra muda de estado mas não entra no progresso', () => {
    const course = makeCourseView({
      access: { allowed: false, reason: 'no_entitlement', expiresAt: null },
    });
    const next = applyCompletion(course, LESSON_1, true);
    expect(next.progress).toBe(course.progress);
    expect(moduleOf(next, MODULE_1).progress).toBe(moduleOf(course, MODULE_1).progress);
    expect(moduleOf(next, MODULE_1).lessons.find((l) => l.id === LESSON_1)?.completed).toBe(true);
  });

  it('a resposta da API substitui a previsão', () => {
    const course = applyCompletion(makeCourseView(), LESSON_3, true);
    const progress = {
      completedLessons: 1,
      totalLessons: 4,
      percent: 25,
      state: 'in_progress',
    } as const;
    const result = {
      lessonId: LESSON_3,
      userState: {
        completedAt: '2026-11-25T12:30:00Z',
        completedVia: 'manual',
        positionSeconds: null,
        lastOpenedAt: null,
      },
      module: { id: MODULE_2, progress: { ...progress, totalLessons: 2, percent: 50 } },
      course: { id: course.id, progress },
      countsForCourse: true,
    } as const;
    const next = applyProgressResult(course, result);
    expect(next.progress).toEqual(progress);
    expect(moduleOf(next, MODULE_2).progress.totalLessons).toBe(2);
    expect(moduleOf(next, MODULE_2).lessons[0]?.completed).toBe(true);

    // amostra que não conta: só o estado da aula muda
    const sample = applyProgressResult(course, { ...result, countsForCourse: false });
    expect(sample.progress).toBe(course.progress);
    // resposta de outro curso é ignorada
    expect(applyProgressResult(course, { ...result, course: { id: 'outro', progress } })).toBe(
      course,
    );
  });
});
