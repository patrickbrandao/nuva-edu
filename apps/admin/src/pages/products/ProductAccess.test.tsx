import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeAccess, productEntitlement } from '../../test/access';
import { problem, type Routes, type StaffRole, sessionFor } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  BUNDLE_ID,
  bundleDetail,
  COURSE_ID,
  EBOOK_ID,
  ebookDetail,
  fakeCatalog,
} from '../../test/courses';
import { renderApp } from '../../test/render';

type ProductEntitlement = AdminSchemas['ProductEntitlement'];

const ID = (n: number) => `0193a5b2-0000-7000-8000-00000000020${n}`;
const USER = (n: number) => `0193a5b2-0000-7000-8000-00000000030${n}`;
const EBOOK_ROUTE = `GET /api/v1/products/ebook/${EBOOK_ID}/entitlements`;

const EBOOK_ACCESS: ProductEntitlement[] = [
  productEntitlement(ID(1), { id: USER(1), name: 'Bia Aluna' }),
  productEntitlement(
    ID(2),
    { id: USER(2), name: 'Caio Aluno' },
    { source: 'cascade', via: { type: 'course', id: COURSE_ID, title: 'Curso de Python' } },
  ),
  productEntitlement(
    ID(3),
    { id: USER(3), name: 'Duda Aluna' },
    {
      source: 'subscription',
      state: 'expired',
      expiresAt: '2026-10-31T23:59:59Z',
    },
  ),
  productEntitlement(
    ID(4),
    { id: USER(4), name: 'Edu Aluno' },
    { source: 'grant', state: 'scheduled', startsAt: '2026-12-01T15:00:00Z' },
  ),
];

interface OpenOptions {
  role?: StaffRole;
  path?: string;
  access?: Record<string, ProductEntitlement[]>;
  pageSize?: number;
  overrides?: Routes;
}

function open({
  role = 'manager',
  path = `/ebooks/${EBOOK_ID}?aba=acessos`,
  access = { [`ebook/${EBOOK_ID}`]: EBOOK_ACCESS },
  pageSize,
  overrides = {},
}: OpenOptions = {}) {
  const catalog = fakeCatalog({
    role,
    ebooks: [ebookDetail({ status: 'published', studentCount: 2 })],
    bundles: [bundleDetail({ status: 'published', studentCount: 1 })],
  });
  const fake = fakeAccess({
    role,
    productAccess: access,
    ...(pageSize ? { pageSize } : {}),
    overrides,
    fallback: catalog.respond,
  });
  return { ...renderApp(path, fake.respond), fake };
}

const section = async () =>
  (await screen.findByRole('heading', { level: 2, name: 'Quem tem acesso' })).closest(
    'section',
  ) as HTMLElement;
const rowOf = (box: HTMLElement, name: string) =>
  within(box).getByText(name).closest('tr') as HTMLElement;

describe('quem tem acesso a um ebook ou pacote (aba "Acessos")', () => {
  it('gerente vê os ativos do ebook com a fonte e o produto de onde vieram, sem violações do axe', async () => {
    const { fake } = open();
    const box = await section();
    await within(box).findByText('Bia Aluna');
    expect(screen.getByRole('tab', { name: 'Acessos', selected: true })).toBeTruthy();

    const bia = rowOf(box, 'Bia Aluna');
    expect(within(bia).getByText('Compra')).toBeTruthy();
    expect(within(bia).getByText('Ativo')).toBeTruthy();
    expect(within(bia).getByText('Vitalício')).toBeTruthy();
    expect(within(bia).getByRole('link', { name: 'Bia Aluna' }).getAttribute('href')).toBe(
      `/alunos/${USER(1)}`,
    );
    const caio = rowOf(box, 'Caio Aluno');
    expect(within(caio).getByText('Cascata')).toBeTruthy();
    expect(within(caio).getByText(/pelo curso/)).toBeTruthy();
    expect(within(caio).getByRole('link', { name: 'Curso de Python' }).getAttribute('href')).toBe(
      `/cursos/${COURSE_ID}`,
    );
    // sem `state`, a API devolve só os ativos
    expect(within(box).queryByText('Duda Aluna')).toBeNull();
    expect(fake.queries(EBOOK_ROUTE)).toEqual([{ state: 'active', limit: '25' }]);
    await expectNoAxeViolations();
  });

  it('o filtro de estado mostra vencidos e agendados e fica no endereço', async () => {
    const user = userEvent.setup();
    const { router } = open();
    const box = await section();
    await within(box).findByText('Bia Aluna');

    await user.click(within(box).getByRole('button', { name: 'Estado: Ativos' }));
    await user.click(screen.getByRole('option', { name: 'Vencidos' }));
    await within(box).findByText('Duda Aluna');
    const duda = rowOf(box, 'Duda Aluna');
    expect(within(duda).getByText('Assinatura')).toBeTruthy();
    expect(within(duda).getByText('Vencido')).toBeTruthy();
    expect(within(duda).getByText('Venceu em 31/10/2026')).toBeTruthy();
    expect(router.state.location.search).toBe('?aba=acessos&acesso=expired');

    await user.click(within(box).getByRole('button', { name: 'Estado: Vencidos' }));
    await user.click(screen.getByRole('option', { name: 'Agendados' }));
    await within(box).findByText('Edu Aluno');
    const edu = rowOf(box, 'Edu Aluno');
    expect(within(edu).getByText('A partir de 01/12/2026')).toBeTruthy();

    await user.click(within(box).getByRole('button', { name: 'Estado: Agendados' }));
    await user.click(screen.getByRole('option', { name: 'Revogados' }));
    expect(await within(box).findByText('Nenhum acesso revogado')).toBeTruthy();

    await user.click(within(box).getByRole('button', { name: 'Estado: Revogados' }));
    await user.click(screen.getByRole('option', { name: 'Ativos' }));
    await waitFor(() => expect(router.state.location.search).toBe('?aba=acessos'));
  });

  it('o estado do endereço sobrevive a recarregar a página', async () => {
    const { fake } = open({ path: `/ebooks/${EBOOK_ID}?aba=acessos&acesso=expired` });
    const box = await section();
    expect(await within(box).findByText('Duda Aluna')).toBeTruthy();
    expect(within(box).getByRole('button', { name: 'Estado: Vencidos' })).toBeTruthy();
    expect(fake.queries(EBOOK_ROUTE)).toEqual([{ state: 'expired', limit: '25' }]);
  });

  it('pacote tem a mesma aba; "carregar mais" busca a página seguinte', async () => {
    const user = userEvent.setup();
    const bundleRoute = `GET /api/v1/products/bundle/${BUNDLE_ID}/entitlements`;
    const { fake } = open({
      path: `/pacotes/${BUNDLE_ID}`,
      pageSize: 1,
      access: {
        [`bundle/${BUNDLE_ID}`]: [
          productEntitlement(ID(5), { id: USER(5), name: 'Fê Aluna' }),
          productEntitlement(ID(6), { id: USER(6), name: 'Gui Aluno' }, { source: 'grant' }),
        ],
      },
    });
    await user.click(await screen.findByRole('tab', { name: 'Acessos' }));
    const box = await section();
    expect(await within(box).findByText('Fê Aluna')).toBeTruthy();
    expect(within(box).queryByText('Gui Aluno')).toBeNull();
    await user.click(within(box).getByRole('button', { name: 'Carregar mais' }));
    expect(await within(box).findByText('Gui Aluno')).toBeTruthy();
    expect(fake.queries(bundleRoute).at(-1)).toEqual({ state: 'active', limit: '25', cursor: '1' });
    expect(within(box).queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('erro ao carregar mostra erro tratado', async () => {
    open({ overrides: { [EBOOK_ROUTE]: () => problem(503, 'database_unavailable') } });
    expect(await screen.findByText('Não foi possível carregar os acessos')).toBeTruthy();
  });

  it('sem `entitlement.manage` a aba não aparece e o endereço cai em "Dados"', async () => {
    const session = sessionFor('manager');
    const { fake } = open({
      overrides: {
        'GET /api/v1/session': {
          ...session,
          permissions: session.permissions.filter((item) => item !== 'entitlement.manage'),
        },
      },
    });
    expect(await screen.findByRole('tab', { name: 'Dados', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Acessos' })).toBeNull();
    expect(fake.requests.some((item) => item.path.endsWith('/entitlements'))).toBe(false);
  });

  it('instrutor não abre o ebook nem vê quem tem acesso', async () => {
    const { fake } = open({ role: 'instructor' });
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Quem tem acesso' })).toBeNull();
    expect(fake.requests.some((item) => item.path.endsWith('/entitlements'))).toBe(false);
  });
});
