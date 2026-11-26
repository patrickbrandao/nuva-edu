import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { PLAN_COURSE_ID, PLAN_EBOOK_ID, PLAN_ID, plan } from '../../test/plans';
import { renderApp } from '../../test/render';

const PRODUCTS: Routes = {
  'GET /api/v1/courses': {
    items: [{ id: PLAN_COURSE_ID, title: 'Curso de Ouro' }],
    nextCursor: null,
  },
  'GET /api/v1/ebooks': {
    items: [{ id: PLAN_EBOOK_ID, title: 'Ebook de Ouro' }],
    nextCursor: null,
  },
  'GET /api/v1/bundles': { items: [], nextCursor: null },
};

function editorRoutes(extra: Routes = {}): Routes {
  return { ...defaultRoutes(), ...PRODUCTS, ...extra };
}

describe('editor de plano (/planos/novo, /planos/:id)', () => {
  it('cria o plano com chave, periodicidade, preço e itens, e abre a edição, sem violações do axe', async () => {
    const user = userEvent.setup();
    const posted: { body?: unknown } = {};
    const created = plan();
    const { routes } = {
      routes: editorRoutes({
        'POST /api/v1/plans': async (request: Request) => {
          posted.body = await request.json();
          return new Response(JSON.stringify(created), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        [`GET /api/v1/plans/${PLAN_ID}`]: created,
      }),
    };
    renderApp('/planos/novo', routes);
    expect(await screen.findByRole('heading', { name: 'Novo plano', level: 1 })).toBeTruthy();
    await expectNoAxeViolations();

    await user.type(screen.getByLabelText('Título'), 'Curso de Ouro');
    await user.type(screen.getByLabelText('Chave do grupo'), 'curso-de-ouro');
    await user.type(screen.getByLabelText('Preço por período'), '97,00');
    await user.click(await screen.findByRole('checkbox', { name: 'Curso de Ouro' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(posted.body).toBeDefined());
    expect(posted.body).toEqual({
      title: 'Curso de Ouro',
      description: null,
      priceCents: 9700,
      includesAll: false,
      includesPrivate: false,
      active: true,
      position: 0,
      groupKey: 'curso-de-ouro',
      interval: 'month',
      items: [{ productType: 'course', productId: PLAN_COURSE_ID }],
    });
    // Depois de criar, a tela passa a editar o plano criado.
    expect(await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 })).toBeTruthy();
    expect(screen.getByText('curso-de-ouro-mensal')).toBeTruthy();
  });

  it('recusa a criação sem título, chave e preço', async () => {
    const user = userEvent.setup();
    renderApp('/planos/novo', editorRoutes());
    await screen.findByRole('heading', { name: 'Novo plano', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(screen.getAllByText('Preencha este campo.').length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByText('Informe um valor em reais, como 97,00.')).toBeTruthy();
  });

  it('mostra a recusa de chave repetida que a API devolve', async () => {
    const user = userEvent.setup();
    const { routes } = {
      routes: editorRoutes({
        'POST /api/v1/plans': () =>
          problem(409, 'plan_group_conflict', {
            detail: 'A chave já existe na periodicidade mensal.',
          }),
      }),
    };
    renderApp('/planos/novo', routes);
    await screen.findByRole('heading', { name: 'Novo plano', level: 1 });

    await user.type(screen.getByLabelText('Título'), 'Curso de Ouro');
    await user.type(screen.getByLabelText('Chave do grupo'), 'curso-de-ouro');
    await user.type(screen.getByLabelText('Preço por período'), '97,00');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(
      await screen.findByText(
        'Já existe um plano com esta chave e periodicidade. Ajuste a chave ou a periodicidade.',
      ),
    ).toBeTruthy();
  });

  it('edita o preço pelo PATCH e os itens pelo PUT que substitui a lista', async () => {
    const user = userEvent.setup();
    let current: AdminSchemas['Plan'] = plan();
    const patched: unknown[] = [];
    const replaced: unknown[] = [];
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: () => current,
        [`PATCH /api/v1/plans/${PLAN_ID}`]: async (request: Request) => {
          const body = (await request.json()) as Partial<AdminSchemas['Plan']>;
          patched.push(body);
          current = { ...current, ...body };
          return current;
        },
        [`PUT /api/v1/plans/${PLAN_ID}/items`]: async (request: Request) => {
          replaced.push(await request.json());
          return current;
        },
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 });
    await expectNoAxeViolations();

    const price = screen.getByLabelText('Preço por período');
    await user.clear(price);
    await user.type(price, '120,00');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({
      title: 'Curso de Ouro',
      description: 'Acesso completo ao Curso de Ouro enquanto a assinatura estiver ativa.',
      priceCents: 12000,
      includesAll: false,
      includesPrivate: false,
      active: true,
      position: 0,
    });

    await user.click(screen.getByRole('button', { name: 'Salvar itens' }));
    await waitFor(() => expect(replaced).toHaveLength(1));
    expect(replaced[0]).toEqual({
      items: [
        { productType: 'course', productId: PLAN_COURSE_ID },
        { productType: 'ebook', productId: PLAN_EBOOK_ID },
      ],
    });
  });

  it('marca a lista de itens escolhidos e salva a substituição', async () => {
    const user = userEvent.setup();
    const replaced: unknown[] = [];
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: () => plan(),
        [`PUT /api/v1/plans/${PLAN_ID}/items`]: async (request: Request) => {
          replaced.push(await request.json());
          return plan();
        },
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 });

    // Desmarca o ebook e acrescenta outro curso da lista (o mesmo produto não entra duas vezes).
    const ebook = screen.getByRole('checkbox', { name: 'Ebook de Ouro' }) as HTMLInputElement;
    expect(ebook.checked).toBe(true);
    await user.click(ebook);
    await user.click(screen.getByRole('button', { name: 'Salvar itens' }));

    await waitFor(() => expect(replaced).toHaveLength(1));
    expect(replaced[0]).toEqual({
      items: [{ productType: 'course', productId: PLAN_COURSE_ID }],
    });
  });

  it('mostra o plano que libera tudo sem a lista de itens', async () => {
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: plan({ includesAll: true, items: [] }),
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 });

    expect(screen.getByText('Tudo, inclusive futuros')).toBeTruthy();
    expect(
      screen.getByText(
        'Este plano libera todos os produtos elegíveis automaticamente, inclusive os publicados depois.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar itens' })).toBeNull();
  });

  it('avisa que o plano com assinaturas só é desativado e que o preço vale para novas', async () => {
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: plan({ subscriptionCount: 4 }),
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 });

    expect(screen.getByText(/4 assinaturas neste plano/)).toBeTruthy();
    expect(
      screen.getByText(
        'Mudar o preço vale para novas assinaturas; as existentes mantêm o preço contratado.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Plano com assinaturas não é excluído, só desativado.')).toBeTruthy();
  });

  it('envia "só privados" apenas junto de "todos os produtos"', async () => {
    const user = userEvent.setup();
    const patched: unknown[] = [];
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: () => plan(),
        [`PATCH /api/v1/plans/${PLAN_ID}`]: async (request: Request) => {
          patched.push(await request.json());
          return plan();
        },
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 });

    const privateSwitch = screen.getByRole('switch', {
      name: 'Inclui também os produtos privados',
    }) as HTMLInputElement;
    expect(privateSwitch.disabled).toBe(true);

    await user.click(screen.getByRole('switch', { name: 'Libera todos os produtos' }));
    await user.click(privateSwitch);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toMatchObject({ includesAll: true, includesPrivate: true });
  });

  it('mostra o plano não encontrado com o caminho de volta', async () => {
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: () => problem(404, 'not_found'),
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    expect(await screen.findByText('Plano não encontrado.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar aos planos' }).getAttribute('href')).toBe(
      '/planos',
    );
  });

  it('mostra a recusa de item inválido ao salvar a lista', async () => {
    const user = userEvent.setup();
    const { routes } = {
      routes: editorRoutes({
        [`GET /api/v1/plans/${PLAN_ID}`]: () => plan(),
        [`PUT /api/v1/plans/${PLAN_ID}/items`]: () =>
          problem(422, 'plan_item_invalid', { detail: 'Produto arquivado.' }),
      }),
    };
    renderApp(`/planos/${PLAN_ID}`, routes);
    await screen.findByRole('heading', { name: 'Curso de Ouro', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Salvar itens' }));
    expect(
      await screen.findByText(
        'Há item inválido na lista: produto inexistente, tipo fora de curso, pacote e ebook, ou repetido.',
      ),
    ).toBeTruthy();
  });
});
