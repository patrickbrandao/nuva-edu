import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { courseStudent, fakeAccess, productEntitlement } from '../../test/access';
import { problem, type Routes, type StaffRole, sessionFor } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { COURSE_ID, courseDetail, fakeCatalog } from '../../test/courses';
import { renderApp } from '../../test/render';

type ProductEntitlement = AdminSchemas['ProductEntitlement'];

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
  path?: string;
  students?: typeof STUDENTS;
  pageSize?: number;
  productAccess?: Record<string, ProductEntitlement[]>;
  overrides?: Routes;
}

function open({
  role = 'manager',
  path = PATH,
  students = STUDENTS,
  pageSize,
  productAccess,
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
    ...(productAccess ? { productAccess } : {}),
    overrides,
    fallback: catalog.respond,
  });
  return { ...renderApp(path, access.respond), access };
}

const section = async (name: string) =>
  (await screen.findByRole('heading', { level: 2, name })).closest('section') as HTMLElement;
/** A tabela dos alunos (o gerente vê abaixo a de quem tem acesso). */
const table = async () => within(await section('Alunos do curso')).findByRole('table');
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

  it('busca, filtro de progresso e ordem vão para a API e para o endereço, sem perder a aba', async () => {
    const user = userEvent.setup();
    const { access, router } = open();
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
    expect(router.state.location.search).toBe('?aba=alunos&q=alun&progresso=completed&sort=name');

    await user.click(screen.getByRole('button', { name: 'Progresso: Concluído' }));
    await user.click(screen.getByRole('option', { name: 'Todos os progressos' }));
    await waitFor(() => expect(router.state.location.search).toBe('?aba=alunos&q=alun&sort=name'));
  });

  it('os filtros do endereço sobrevivem a recarregar a página', async () => {
    const { access } = open({ path: `${PATH}&q=alun&progresso=completed&sort=name` });
    await waitFor(async () => expect(names(await table())).toEqual(['Caio Aluno', 'Edu Aluno']));
    expect(access.queries(STUDENTS_ROUTE)).toEqual([
      { q: 'alun', state: 'completed', sort: 'name', limit: '25' },
    ]);
    expect(
      (screen.getByRole('searchbox', { name: 'Buscar aluno pelo nome' }) as HTMLInputElement).value,
    ).toBe('alun');
    expect(screen.getByRole('button', { name: 'Progresso: Concluído' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ordem: Nome' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Alunos', selected: true })).toBeTruthy();
  });

  it('valor fora das opções no endereço vale como o padrão', async () => {
    const { access } = open({ path: `${PATH}&progresso=xyz&sort=abc` });
    await table();
    expect(access.queries(STUDENTS_ROUTE)).toEqual([{ sort: '-lastActivityAt', limit: '25' }]);
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

describe('quem tem acesso ao curso (/cursos/:id?aba=alunos)', () => {
  const ACCESS_ROUTE = `GET /api/v1/products/course/${COURSE_ID}/entitlements`;
  const ACCESS = {
    [`course/${COURSE_ID}`]: [
      productEntitlement(ID(5), { id: ID(1), name: 'Bia Aluna' }, { source: 'grant' }),
      productEntitlement(
        ID(6),
        { id: ID(2), name: 'Caio Aluno' },
        {
          source: 'cascade',
          via: { type: 'bundle', id: ID(9), title: 'Pacote Python' },
          expiresAt: '2027-03-31T23:59:59Z',
        },
      ),
      productEntitlement(
        ID(7),
        { id: ID(3), name: 'Duda Aluna' },
        { state: 'revoked', revokedAt: '2026-11-01T10:00:00Z' },
      ),
    ],
  };

  it('gerente vê a fonte e o estado de cada direito ao curso; instrutor não vê a seção', async () => {
    const first = open({ productAccess: ACCESS });
    const box = await section('Quem tem acesso');
    const rows = await within(box).findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('Concessão manual')).toBeTruthy();
    const caio = rows[2] as HTMLElement;
    expect(within(caio).getByText('Cascata')).toBeTruthy();
    expect(within(caio).getByText(/pelo pacote/)).toBeTruthy();
    expect(within(caio).getByRole('link', { name: 'Pacote Python' }).getAttribute('href')).toBe(
      `/pacotes/${ID(9)}`,
    );
    expect(within(caio).getByText('Até 31/03/2027')).toBeTruthy();
    first.unmount();

    const { access } = open({ role: 'instructor', productAccess: ACCESS });
    await table();
    expect(screen.queryByRole('heading', { level: 2, name: 'Quem tem acesso' })).toBeNull();
    expect(access.requests.some((item) => item.path.endsWith('/entitlements'))).toBe(false);
  });

  it('o filtro de estado vai para a API e para o endereço, ao lado dos filtros dos alunos', async () => {
    const user = userEvent.setup();
    const { access, router } = open({ path: `${PATH}&progresso=completed`, productAccess: ACCESS });
    const box = await section('Quem tem acesso');
    await within(box).findByText('Bia Aluna');
    await user.click(within(box).getByRole('button', { name: 'Estado: Ativos' }));
    await user.click(screen.getByRole('option', { name: 'Revogados' }));
    expect(await within(box).findByText('Revogado em 01/11/2026')).toBeTruthy();
    expect(access.queries(ACCESS_ROUTE).at(-1)).toEqual({ state: 'revoked', limit: '25' });
    expect(router.state.location.search).toBe('?aba=alunos&progresso=completed&acesso=revoked');
  });
});
