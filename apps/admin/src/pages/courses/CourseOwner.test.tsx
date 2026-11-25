import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { problem } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  COURSE_ID,
  courseDetail,
  courseModule,
  fakeCatalog,
  INSTRUCTOR,
  lessonSummary,
  stubSortableLayout,
} from '../../test/courses';
import { renderApp } from '../../test/render';

const PATH = `/cursos/${COURSE_ID}`;
const OWNER_ROUTE = `PATCH /api/v1/courses/${COURSE_ID}/owner`;
const LIA = { id: '0193a5b2-0000-7000-8000-0000000000d2', name: 'Lia Instrutora' };
const M1 = '0193a5b2-0000-7000-8000-0000000000e1';
const M2 = '0193a5b2-0000-7000-8000-0000000000e2';
const L1 = '0193a5b2-0000-7000-8000-0000000000f1';
const L2 = '0193a5b2-0000-7000-8000-0000000000f2';
const L3 = '0193a5b2-0000-7000-8000-0000000000f3';

function filled() {
  return courseDetail({
    moduleCount: 2,
    modules: [
      courseModule({
        id: M1,
        title: 'Fundamentos',
        lessons: [
          lessonSummary({ id: L1, moduleId: M1, title: 'Variáveis' }),
          lessonSummary({ id: L2, moduleId: M1, title: 'Funções', position: 1 }),
        ],
      }),
      courseModule({
        id: M2,
        title: 'Projetos',
        position: 1,
        lessons: [lessonSummary({ id: L3, moduleId: M2, title: 'Calculadora' })],
      }),
    ],
  });
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const ownerSection = async () =>
  (await screen.findByRole('heading', { level: 2, name: 'Dono do curso' })).closest(
    'section',
  ) as HTMLElement;

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubSortableLayout();
});
afterEach(() => restoreLayout());

describe('dono do curso no editor', () => {
  it('gerente troca o dono pela busca de instrutores e depois deixa o curso sem dono', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'manager',
      courses: [courseDetail()],
      instructors: [INSTRUCTOR, LIA],
    });
    renderApp(PATH, catalog.respond);
    const section = await ownerSection();
    expect(within(section).getByText('Ivo Instrutor')).toBeTruthy();

    await user.click(within(section).getByRole('button', { name: 'Trocar o dono' }));
    const box = await screen.findByRole('dialog', { name: 'Dono do curso “Curso de Python”' });
    // nada mudou ainda: não há o que salvar
    expect(within(box).getByRole('button', { name: 'Salvar' })).toHaveProperty('disabled', true);
    await user.type(
      within(box).getByRole('searchbox', { name: 'Buscar instrutor por nome ou e-mail' }),
      'lia{Enter}',
    );
    await user.click(await within(box).findByRole('button', { name: 'Escolher Lia Instrutora' }));
    await expectNoAxeViolations();
    await user.click(within(box).getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Dono do curso alterado para Lia Instrutora.')).toBeTruthy();
    expect(catalog.bodies(OWNER_ROUTE)).toEqual([{ ownerId: LIA.id }]);
    const users = catalog.requests.filter((item) => item.path === '/api/v1/users');
    expect(users.at(-1)?.query.get('role')).toBe('instructor');
    expect(users.at(-1)?.query.get('q')).toBe('lia');
    await waitFor(() => expect(within(section).getByText('Lia Instrutora')).toBeTruthy());

    await user.click(within(section).getByRole('button', { name: 'Trocar o dono' }));
    const again = await screen.findByRole('dialog', { name: 'Dono do curso “Curso de Python”' });
    await user.click(within(again).getByRole('button', { name: 'Deixar sem dono' }));
    await user.click(within(again).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('O curso ficou sem dono.')).toBeTruthy();
    expect(catalog.bodies(OWNER_ROUTE)[1]).toEqual({ ownerId: null });
    expect(catalog.course(COURSE_ID)?.owner).toBeNull();
    await waitFor(() => expect(within(section).getByText('Sem dono')).toBeTruthy());
  });

  it('instrutor não vê a seção do dono', async () => {
    const catalog = fakeCatalog({ role: 'instructor', courses: [courseDetail()] });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    await screen.findByRole('heading', { level: 2, name: 'Dados do curso' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Dono do curso' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trocar o dono' })).toBeNull();
  });

  it('dono recusado pela API (422 owner_invalid) aparece na escolha, sem fechar', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'manager',
      courses: [courseDetail({ owner: null })],
      overrides: { [OWNER_ROUTE]: () => problem(422, 'owner_invalid') },
    });
    renderApp(PATH, catalog.respond);
    await user.click(within(await ownerSection()).getByRole('button', { name: 'Trocar o dono' }));
    const box = await screen.findByRole('dialog', { name: 'Dono do curso “Curso de Python”' });
    await user.click(await within(box).findByRole('button', { name: 'Escolher Ivo Instrutor' }));
    await user.click(within(box).getByRole('button', { name: 'Salvar' }));
    expect(
      within(await within(box).findByRole('alert')).getByText(
        'O dono do curso precisa ser um instrutor.',
      ),
    ).toBeTruthy();
  });
});

describe('mover aula entre módulos', () => {
  it('move a aula para o fim de outro módulo pelo teclado e grava a ordem', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(`${PATH}?aba=conteudo`, catalog.respond);
    const move = await screen.findByRole('button', {
      name: 'Mover a aula Variáveis para outro módulo',
    });
    move.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    // só os outros módulos do curso
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Projetos']);
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Projetos' })),
    );
    await user.keyboard('{Enter}');

    expect(
      await screen.findByText('Aula “Variáveis” movida para o módulo “Projetos”.'),
    ).toBeTruthy();
    expect(catalog.bodies(`PUT /api/v1/modules/${M2}/lessons/order`)).toEqual([
      { lessonIds: [L3, L1] },
    ]);
    const modules = catalog.course(COURSE_ID)?.modules ?? [];
    expect(modules.map((item) => item.lessons.map((lesson) => lesson.title))).toEqual([
      ['Funções'],
      ['Calculadora', 'Variáveis'],
    ]);
    const target = await screen.findByRole('list', { name: 'Aulas do módulo Projetos' });
    await waitFor(() => expect(within(target).getByText('Variáveis')).toBeTruthy());
  });

  it('curso de um módulo só não oferece mover; a recusa da API vira aviso e a ordem volta', async () => {
    const user = userEvent.setup();
    const single = courseDetail({
      moduleCount: 1,
      modules: [courseModule({ id: M1, lessons: [lessonSummary({ id: L1, moduleId: M1 })] })],
    });
    const first = renderApp(`${PATH}?aba=conteudo`, fakeCatalog({ courses: [single] }).respond);
    await screen.findByRole('list', { name: 'Aulas do módulo Módulo 1' });
    expect(screen.queryByRole('button', { name: /^Mover a aula/ })).toBeNull();
    first.unmount();

    const catalog = fakeCatalog({
      courses: [filled()],
      overrides: {
        [`PUT /api/v1/modules/${M2}/lessons/order`]: () => problem(422, 'order_mismatch'),
      },
    });
    renderApp(`${PATH}?aba=conteudo`, catalog.respond);
    await user.click(
      await screen.findByRole('button', { name: 'Mover a aula Variáveis para outro módulo' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Projetos' }));
    expect(await screen.findByText('Não foi possível mover a aula')).toBeTruthy();
    const source = await screen.findByRole('list', { name: 'Aulas do módulo Fundamentos' });
    await waitFor(() => expect(within(source).getByText('Variáveis')).toBeTruthy());
  });
});

describe('filtro por dono na lista de cursos', () => {
  const PYTHON = courseDetail();
  const DESIGN = courseDetail({
    id: '0193a5b2-0000-7000-8000-0000000000c2',
    slug: 'design',
    title: 'Design para iniciantes',
    owner: LIA,
  });

  it('gerente escolhe o dono, o filtro vai para o endereço e para a API, e sai por "todos"', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'manager',
      courses: [PYTHON, DESIGN],
      instructors: [INSTRUCTOR, LIA],
    });
    const { router } = renderApp('/cursos', catalog.respond);
    await screen.findByRole('link', { name: 'Curso de Python' });

    await user.click(screen.getByRole('button', { name: 'Dono: todos' }));
    const box = await screen.findByRole('dialog', { name: 'Filtrar por dono' });
    await user.click(await within(box).findByRole('button', { name: 'Escolher Lia Instrutora' }));

    await waitFor(() => expect(router.state.location.search).toBe(`?dono=${LIA.id}`));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Curso de Python' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Design para iniciantes' })).toBeTruthy();
    const last = catalog.requests.filter((item) => item.path === '/api/v1/courses').at(-1);
    expect(last?.query.get('ownerId')).toBe(LIA.id);

    await user.click(screen.getByRole('button', { name: 'Dono: Lia Instrutora' }));
    const again = await screen.findByRole('dialog', { name: 'Filtrar por dono' });
    await user.click(within(again).getByRole('button', { name: 'Todos os donos' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByRole('link', { name: 'Curso de Python' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dono: todos' })).toBeTruthy();
  });

  it('endereço com o dono mostra o nome mesmo sem cursos dele; instrutor não tem o filtro', async () => {
    const first = renderApp(
      `/cursos?dono=${LIA.id}`,
      fakeCatalog({ role: 'manager', courses: [PYTHON], instructors: [INSTRUCTOR, LIA] }).respond,
    );
    expect(await screen.findByRole('button', { name: 'Dono: Lia Instrutora' })).toBeTruthy();
    expect(screen.getByText('Nenhum curso encontrado')).toBeTruthy();
    first.unmount();

    const catalog = fakeCatalog({ role: 'instructor', courses: [PYTHON] });
    renderApp(`/cursos?dono=${LIA.id}`, catalog.respond);
    await screen.findByRole('link', { name: 'Curso de Python' });
    expect(screen.queryByRole('button', { name: /^Dono:/ })).toBeNull();
    const sent = catalog.requests.find((item) => item.path === '/api/v1/courses');
    expect(sent?.query.has('ownerId')).toBe(false);
  });
});
