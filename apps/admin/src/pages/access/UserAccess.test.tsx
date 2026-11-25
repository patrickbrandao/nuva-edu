import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  cascade,
  entitlement,
  fakeAccess,
  GRANT_ID,
  ORDER_ID,
  progressCounts,
} from '../../test/access';
import { problem, type Routes, type StaffRole, sessionFor } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { COURSE_ID, courseDetail, EBOOK_ID, ebookDetail, fakeCatalog } from '../../test/courses';
import { renderApp } from '../../test/render';
import { STUDENT_ID, userDetail } from '../../test/users';

const PATH = `/alunos/${STUDENT_ID}`;
const COURSE = { type: 'course', id: COURSE_ID, title: 'Curso de Python' } as const;
const EBOOK = { type: 'ebook', id: EBOOK_ID, title: 'Guia de Python' } as const;
const GRANT_ROUTE = `POST /api/v1/users/${STUDENT_ID}/entitlements`;
const REVOKE_ROUTE = `POST /api/v1/entitlements/${GRANT_ID}/revoke`;

/** Concessão manual do curso (com o ebook em cascata) e uma compra do ebook. */
function tree() {
  const grant = entitlement();
  grant.children = [cascade(grant, EBOOK, '0193a5b2-0000-7000-8000-0000000000a3')];
  const order = entitlement({
    id: ORDER_ID,
    product: EBOOK,
    source: 'order',
    sourceId: '0193a5b2-0000-7000-8000-0000000000a4',
    grantedReason: null,
    grantedBy: null,
    expiresAt: '2027-06-30T23:59:59Z',
  });
  return [grant, order];
}

interface OpenOptions {
  role?: StaffRole;
  entitlements?: ReturnType<typeof tree>;
  progress?: AdminSchemas['UserCourseProgress'][] | null;
  overrides?: Routes;
}

/** Abre a ficha do aluno com os direitos, o progresso e o catálogo simulados. */
function open({
  role = 'manager',
  entitlements = [],
  progress = [],
  overrides = {},
}: OpenOptions = {}) {
  const catalog = fakeCatalog({
    role,
    courses: [courseDetail({ status: 'published' })],
    ebooks: [ebookDetail()],
    overrides: {
      [`GET /api/v1/users/${STUDENT_ID}`]: userDetail(),
      [`GET /api/v1/users/${STUDENT_ID}/sessions`]: { items: [] },
    },
  });
  const access = fakeAccess({
    role,
    userId: STUDENT_ID,
    entitlements,
    progress,
    products: [COURSE, EBOOK],
    overrides,
    fallback: catalog.respond,
  });
  const view = renderApp(PATH, access.respond);
  return { ...view, access };
}

const accessTree = () => screen.findByRole('list', { name: 'Acessos de Bia Aluna' });
const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });

/** Abre "Conceder acesso" e escolhe o curso na busca. */
async function openGrant(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Conceder acesso' }));
  const box = await dialog('Conceder acesso a Bia Aluna');
  return box;
}
async function pickCourse(user: ReturnType<typeof userEvent.setup>, box: HTMLElement) {
  await user.click(await within(box).findByRole('button', { name: 'Escolher Curso de Python' }));
  expect(within(box).getByText('Curso: Curso de Python')).toBeTruthy();
}

describe('acessos na ficha do aluno', () => {
  it('mostra a árvore: raiz, fonte, situação, validade, motivo e a cascata', async () => {
    open({ entitlements: tree() });
    const list = await accessTree();
    const [grant, order] = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list);
    expect(within(grant as HTMLElement).getByText('Concessão manual')).toBeTruthy();
    // a raiz e o derivado dela
    expect(within(grant as HTMLElement).getAllByText('Vitalício')).toHaveLength(2);
    expect(
      within(grant as HTMLElement).getByText('Concedido por Ana Admin: Bolsa de estudos'),
    ).toBeTruthy();
    const derived = within(grant as HTMLElement).getByRole('list', {
      name: 'Liberados por Curso de Python',
    });
    expect(within(derived).getByText('Guia de Python')).toBeTruthy();
    expect(within(derived).getByText('Cascata')).toBeTruthy();
    expect(within(order as HTMLElement).getByText('Compra')).toBeTruthy();
    expect(within(order as HTMLElement).getByText(/^Até /)).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('"Revogar" só aparece na raiz de concessão manual ainda vigente', async () => {
    const entitlements = [
      ...tree(),
      entitlement({
        id: '0193a5b2-0000-7000-8000-0000000000a5',
        product: { type: 'bundle', id: '0193a5b2-0000-7000-8000-0000000000a9', title: 'Trilha' },
        state: 'revoked',
        revokedAt: '2026-11-10T12:00:00Z',
        revokeReason: 'manual',
      }),
    ];
    open({ entitlements });
    const list = await accessTree();
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Revogar o acesso a Curso de Python',
    ]);
    expect(within(list).getByText(/Revogado em .+ \(revogação manual\)/)).toBeTruthy();
  });

  it('sem direitos mostra o vazio; sem `entitlement.manage` a seção nem aparece', async () => {
    const first = open();
    expect(await screen.findByText('Nenhum acesso')).toBeTruthy();
    first.unmount();

    const session = sessionFor('manager');
    const { access } = open({
      overrides: {
        'GET /api/v1/session': {
          ...session,
          permissions: session.permissions.filter((item) => item !== 'entitlement.manage'),
        },
      },
    });
    await screen.findByRole('heading', { level: 2, name: 'Progresso' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Acessos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Conceder acesso' })).toBeNull();
    expect(access.requests.some((item) => item.path.endsWith('/entitlements'))).toBe(false);
  });

  it('erro ao carregar os direitos mostra erro tratado', async () => {
    open({
      overrides: {
        [`GET /api/v1/users/${STUDENT_ID}/entitlements`]: () =>
          problem(503, 'database_unavailable'),
      },
    });
    expect(await screen.findByText('Não foi possível carregar os acessos')).toBeTruthy();
  });

  describe('conceder', () => {
    it('exige o produto e o motivo: sem eles nada é enviado', async () => {
      const user = userEvent.setup();
      const { access } = open();
      const box = await openGrant(user);
      await within(box).findByRole('list', { name: 'Produtos encontrados' });
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      expect(within(box).getByText('Escolha o produto.')).toBeTruthy();
      expect(within(box).getByText('Preencha este campo.')).toBeTruthy();

      await pickCourse(user, box);
      await user.type(within(box).getByLabelText('Motivo'), '   ');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      expect(within(box).getByText('Preencha este campo.')).toBeTruthy();
      expect(within(box).getByLabelText('Motivo').getAttribute('aria-invalid')).toBe('true');
      expect(access.writes()).toEqual([]);
    });

    it('concessão nova (201): envia produto, motivo e validade, avisa e mostra na árvore', async () => {
      const user = userEvent.setup();
      const { access } = open();
      const box = await openGrant(user);
      await pickCourse(user, box);
      await user.type(within(box).getByLabelText('Motivo'), ' Bolsa integral ');
      await user.type(within(box).getByLabelText('Validade (opcional)'), '2099-12-31');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));

      expect(await screen.findByText('Acesso a “Curso de Python” concedido.')).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const [body] = access.bodies(GRANT_ROUTE) as Record<string, unknown>[];
      expect(body).toEqual({
        productType: 'course',
        productId: COURSE_ID,
        reason: 'Bolsa integral',
        expiresAt: new Date(2099, 11, 31, 23, 59, 59).toISOString(),
      });
      const list = await accessTree();
      expect(within(list).getByText('Concedido por Ana Admin: Bolsa integral')).toBeTruthy();
      expect(
        within(list).getByRole('button', { name: 'Revogar o acesso a Curso de Python' }),
      ).toBeTruthy();
    });

    it('sem validade não envia `expiresAt` (vitalício); busca outro tipo de produto', async () => {
      const user = userEvent.setup();
      const { access } = open();
      const box = await openGrant(user);
      await user.click(within(box).getByRole('button', { name: 'Tipo de produto: Curso' }));
      await user.click(await screen.findByRole('option', { name: 'Ebook' }));
      await user.type(
        within(box).getByRole('searchbox', { name: /Buscar produto/ }),
        'guia{Enter}',
      );
      await user.click(await within(box).findByRole('button', { name: 'Escolher Guia de Python' }));
      await user.type(within(box).getByLabelText('Motivo'), 'Cortesia');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      await screen.findByText('Acesso a “Guia de Python” concedido.');
      expect(access.bodies(GRANT_ROUTE)).toEqual([
        { productType: 'ebook', productId: EBOOK_ID, reason: 'Cortesia' },
      ]);
      // Enter na busca não enviou o formulário
      expect(access.writes()).toEqual([GRANT_ROUTE]);
    });

    it('concessão repetida (200): avisa que já existia e não duplica', async () => {
      const user = userEvent.setup();
      const { access } = open({ entitlements: [entitlement()] });
      const box = await openGrant(user);
      await pickCourse(user, box);
      await user.type(within(box).getByLabelText('Motivo'), 'De novo');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      expect(
        await screen.findByText(
          '“Curso de Python” já estava concedido por você a este usuário. Nada mudou.',
        ),
      ).toBeTruthy();
      expect(screen.queryByText('Acesso a “Curso de Python” concedido.')).toBeNull();
      expect(access.roots()).toHaveLength(1);
    });

    it('validade no passado é recusada no campo, sem enviar; a recusa da API (422) também', async () => {
      const user = userEvent.setup();
      const { access } = open({
        overrides: { [GRANT_ROUTE]: () => problem(422, 'expires_at_in_past') },
      });
      const box = await openGrant(user);
      await pickCourse(user, box);
      await user.type(within(box).getByLabelText('Motivo'), 'Teste');
      const expires = within(box).getByLabelText('Validade (opcional)');
      await user.type(expires, '2020-01-01');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      expect(within(box).getByText('A validade precisa ser uma data futura.')).toBeTruthy();
      expect(access.writes()).toEqual([]);

      await user.clear(expires);
      await user.type(expires, '2099-01-01');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      await waitFor(() => expect(access.writes()).toEqual([GRANT_ROUTE]));
      expect(await within(box).findByText('A validade precisa ser uma data futura.')).toBeTruthy();
      expect(expires.getAttribute('aria-invalid')).toBe('true');
      expect(within(box).queryByRole('alert')).toBeNull();
    });

    it('produto que deixou de existir (404) vira aviso no diálogo', async () => {
      const user = userEvent.setup();
      open({ overrides: { [GRANT_ROUTE]: () => problem(404, 'not_found') } });
      const box = await openGrant(user);
      await pickCourse(user, box);
      await user.type(within(box).getByLabelText('Motivo'), 'Teste');
      await user.click(within(box).getByRole('button', { name: 'Conceder' }));
      expect(
        within(await within(box).findByRole('alert')).getByText(
          'O usuário ou o produto não existe mais.',
        ),
      ).toBeTruthy();
    });
  });

  describe('revogar', () => {
    it('exige o motivo, envia, avisa e a árvore passa a mostrar "Revogado" sem o botão', async () => {
      const user = userEvent.setup();
      const { access } = open({ entitlements: tree() });
      await user.click(
        await screen.findByRole('button', { name: 'Revogar o acesso a Curso de Python' }),
      );
      const box = await dialog('Revogar o acesso a “Curso de Python”?');
      await user.click(within(box).getByRole('button', { name: 'Revogar o acesso' }));
      expect(within(box).getByText('Preencha este campo.')).toBeTruthy();
      expect(access.writes()).toEqual([]);

      await user.type(within(box).getByLabelText('Motivo'), 'Concedido por engano');
      await user.click(within(box).getByRole('button', { name: 'Revogar o acesso' }));
      expect(await screen.findByText('Acesso a “Curso de Python” revogado.')).toBeTruthy();
      expect(access.bodies(REVOKE_ROUTE)).toEqual([{ reason: 'Concedido por engano' }]);
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Revogar o acesso a Curso de Python' }),
        ).toBeNull(),
      );
      const list = await accessTree();
      // a raiz e o derivado dela
      expect(within(list).getAllByText('Revogado')).toHaveLength(2);
    });

    it('recusa da API (409) aparece no diálogo', async () => {
      const user = userEvent.setup();
      open({
        entitlements: tree(),
        overrides: { [REVOKE_ROUTE]: () => problem(409, 'entitlement_already_revoked') },
      });
      await user.click(
        await screen.findByRole('button', { name: 'Revogar o acesso a Curso de Python' }),
      );
      const box = await dialog('Revogar o acesso a “Curso de Python”?');
      await user.type(within(box).getByLabelText('Motivo'), 'Teste');
      await user.click(within(box).getByRole('button', { name: 'Revogar o acesso' }));
      expect(
        within(await within(box).findByRole('alert')).getByText('Este acesso já foi revogado.'),
      ).toBeTruthy();
    });
  });
});

describe('progresso na ficha do aluno', () => {
  const PROGRESS = [
    {
      course: COURSE,
      progress: progressCounts(3, 10),
      lastActivityAt: '2026-11-19T15:00:00Z',
      certificate: null,
    },
    {
      course: { type: 'course', id: '0193a5b2-0000-7000-8000-0000000000c2', title: 'Curso de SQL' },
      progress: progressCounts(4, 4),
      lastActivityAt: '2026-11-01T15:00:00Z',
      certificate: {
        id: '0193a5b2-0000-7000-8000-0000000000c9',
        code: 'ABCD-EFGH-JKLM',
        state: 'issued',
      },
    },
  ] as const;

  it('lista os cursos com barra, aulas concluídas, atividade e certificado', async () => {
    open({ progress: [...PROGRESS] });
    const list = await screen.findByRole('list', { name: 'Progresso de Bia Aluna por curso' });
    const bar = within(list).getByRole('progressbar', { name: 'Progresso em Curso de Python' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 de 10 aulas concluídas');
    expect(within(list).getByText('Em andamento')).toBeTruthy();
    expect(within(list).getByText('Concluído')).toBeTruthy();
    expect(within(list).getByText(/Certificado ABCD-EFGH-JKLM · emitido/)).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'Curso de Python' }).getAttribute('href')).toBe(
      `/cursos/${COURSE_ID}`,
    );
    await expectNoAxeViolations();
  });

  it('usuário sem curso ao alcance de quem vê (404) mostra o vazio, não um erro', async () => {
    open({ progress: null });
    expect(await screen.findByText('Nenhum curso')).toBeTruthy();
  });

  it('erro do servidor mostra erro tratado', async () => {
    open({
      overrides: {
        [`GET /api/v1/users/${STUDENT_ID}/progress`]: () => problem(503, 'database_unavailable'),
      },
    });
    expect(await screen.findByText('Não foi possível carregar o progresso')).toBeTruthy();
  });
});
