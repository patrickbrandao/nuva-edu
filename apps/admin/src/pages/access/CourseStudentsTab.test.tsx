import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { courseStudent, fakeAccess } from '../../test/access';
import { problem, type Routes, type StaffRole, sessionFor } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { COURSE_ID, courseDetail, fakeCatalog } from '../../test/courses';
import { renderApp } from '../../test/render';

const PATH = `/cursos/${COURSE_ID}?aba=alunos`;
const STUDENTS_ROUTE = `GET /api/v1/courses/${COURSE_ID}/students`;
const ID = (n: number) => `0193a5b2-0000-7000-8000-00000000010${n}`;

const STUDENTS = [
  courseStudent(ID(1), 'Bia Aluna', 3),
  courseStudent(ID(2), 'Caio Aluno', 10, 10, { accessExpiresAt: '2027-03-31T23:59:59Z' }),
  courseStudent(ID(3), 'Duda Aluna', 0),
  courseStudent(ID(4), 'Edu Aluno', 10),
];

interface OpenOptions {
  role?: StaffRole;
  students?: typeof STUDENTS;
  pageSize?: number;
  overrides?: Routes;
}

function open({
  role = 'manager',
  students = STUDENTS,
  pageSize,
  overrides = {},
}: OpenOptions = {}) {
  const catalog = fakeCatalog({
    role,
    courses: [courseDetail({ status: 'published', studentCount: students.length })],
  });
  const access = fakeAccess({
    role,
    courseId: COURSE_ID,
    students,
    ...(pageSize ? { pageSize } : {}),
    overrides,
    fallback: catalog.respond,
  });
  return { ...renderApp(PATH, access.respond), access };
}

const table = () => screen.findByRole('table');
/** Nomes na ordem da tabela (para o gerente, o nome é o link da ficha). */
const names = (node: HTMLElement) =>
  within(node)
    .queryAllByRole('link')
    .map((link) => link.textContent);

describe('alunos do curso (/cursos/:id?aba=alunos)', () => {
  it('mostra o resumo de progresso e a lista com barra, situação, atividade e prazo', async () => {
    open();
    const summary = (
      await screen.findByRole('heading', { level: 2, name: 'Resumo de progresso' })
    ).closest('section') as HTMLElement;
    expect(await within(summary).findByText('Alunos com acesso')).toBeTruthy();
    expect(within(summary).getByText('50%')).toBeTruthy();
    const buckets = within(summary).getByText('Concluíram').closest('div') as HTMLElement;
    expect(within(buckets).getByText('2')).toBeTruthy();

    const list = await table();
    expect(within(list).getAllByRole('row')).toHaveLength(5);
    const bar = within(list).getByRole('progressbar', { name: 'Progresso em Bia Aluna' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 de 10 aulas concluídas');
    expect(within(list).getByText('Em andamento')).toBeTruthy();
    expect(within(list).getByText('Não iniciado')).toBeTruthy();
    expect(within(list).getByText('Sem atividade')).toBeTruthy();
    expect(within(list).getAllByText('Sem prazo')).toHaveLength(3);
    await expectNoAxeViolations();
  });

  it('gerente abre a ficha do aluno pelo nome; instrutor vê só o nome', async () => {
    const first = open();
    const list = await table();
    expect(within(list).getByRole('link', { name: 'Bia Aluna' }).getAttribute('href')).toBe(
      `/alunos/${ID(1)}`,
    );
    first.unmount();

    open({ role: 'instructor' });
    const own = await table();
    expect(within(own).getByText('Bia Aluna')).toBeTruthy();
    expect(within(own).queryByRole('link')).toBeNull();
  });

  it('busca, filtro de progresso e ordem vão para a API', async () => {
    const user = userEvent.setup();
    const { access } = open();
    await table();
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar aluno pelo nome' }),
      'alun{Enter}',
    );
    await waitFor(async () => expect(names(await table())).toHaveLength(4));
    await user.click(screen.getByRole('button', { name: 'Progresso: Todos os progressos' }));
    await user.click(screen.getByRole('option', { name: 'Concluído' }));
    await waitFor(async () => expect(names(await table())).toEqual(['Caio Aluno', 'Edu Aluno']));
    await user.click(screen.getByRole('button', { name: 'Ordem: Atividade mais recente' }));
    await user.click(screen.getByRole('option', { name: 'Nome' }));
    await waitFor(() =>
      expect(access.queries(STUDENTS_ROUTE).at(-1)).toEqual({
        q: 'alun',
        state: 'completed',
        sort: 'name',
        limit: '25',
      }),
    );
  });

  it('"carregar mais" busca a página seguinte pelo cursor', async () => {
    const user = userEvent.setup();
    const { access } = open({ pageSize: 2 });
    await waitFor(async () => expect(names(await table())).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(async () => expect(names(await table())).toHaveLength(4));
    expect(access.queries(STUDENTS_ROUTE).at(-1)?.cursor).toBe('2');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('curso sem alunos mostra o vazio; filtro sem resultado, o vazio do filtro', async () => {
    const user = userEvent.setup();
    const first = open({ students: [] });
    expect(await screen.findByText('Ninguém tem acesso a este curso ainda.')).toBeTruthy();
    first.unmount();

    open();
    await table();
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar aluno pelo nome' }),
      'zzz{Enter}',
    );
    expect(await screen.findByText('Nenhum aluno encontrado')).toBeTruthy();
  });

  it('erro ao carregar mostra erro tratado, em cada parte', async () => {
    open({
      overrides: {
        [STUDENTS_ROUTE]: () => problem(503, 'database_unavailable'),
        [`GET /api/v1/courses/${COURSE_ID}/progress-summary`]: () =>
          problem(503, 'database_unavailable'),
      },
    });
    expect(await screen.findByText('Não foi possível carregar os alunos')).toBeTruthy();
    expect(await screen.findByText('Não foi possível carregar o resumo')).toBeTruthy();
  });

  it('sem `progress.view` a aba não aparece', async () => {
    const session = sessionFor('manager');
    const { access } = open({
      overrides: {
        'GET /api/v1/session': {
          ...session,
          permissions: session.permissions.filter((item) => item !== 'progress.view'),
        },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Curso de Python' });
    expect(screen.queryByRole('tab', { name: 'Alunos' })).toBeNull();
    expect(access.requests.some((item) => item.path.endsWith('/students'))).toBe(false);
  });
});
