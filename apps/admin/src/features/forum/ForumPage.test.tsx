import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, type Routes, type StaffRole } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  CATEGORY_ID,
  forumCategory,
  forumPost,
  forumTopic,
  forumTopicDetail,
  POST_ID,
  TOPIC_ID,
} from '../../test/forum';
import { findMenu, renderApp } from '../../test/render';

const OTHER_CATEGORY = '0193a5b2-0000-7000-8000-0000000000fa';

function forumRoutes(extra: Routes = {}, role: StaffRole = 'admin') {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(role),
    'GET /api/v1/forum/categories': {
      items: [
        forumCategory(),
        forumCategory({ id: OTHER_CATEGORY, name: 'Curso de React', kind: 'course' }),
      ],
      nextCursor: null,
    },
    'GET /api/v1/forum/topics': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return { items: [forumTopic()], nextCursor: null };
    },
    [`GET /api/v1/forum/topics/${TOPIC_ID}`]: forumTopicDetail(),
    [`GET /api/v1/forum/topics/${TOPIC_ID}/posts`]: { items: [forumPost()], nextCursor: null },
    ...extra,
  };
  return { routes, queries };
}

describe('fórum no admin (/forum)', () => {
  it('lista categorias e tópicos, com gestão só das categorias livres, sem violações do axe', async () => {
    const { routes } = forumRoutes();
    renderApp('/forum', routes);

    expect(await screen.findByRole('link', { name: 'Dúvida sobre o módulo 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nova categoria' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Editar categoria' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Arquivar' })).toHaveLength(1);
    await expectNoAxeViolations();
  });

  it('cria, edita e arquiva categoria livre', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const { routes } = forumRoutes({
      'POST /api/v1/forum/categories': async (request: Request) => {
        bodies.push(await request.json());
        return new Response(JSON.stringify(forumCategory({ name: 'Projetos' })), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      [`PATCH /api/v1/forum/categories/${CATEGORY_ID}`]: async (request: Request) => {
        bodies.push(await request.json());
        return forumCategory();
      },
    });
    renderApp('/forum', routes);
    await screen.findByRole('link', { name: 'Dúvida sobre o módulo 2' });

    await user.click(screen.getByRole('button', { name: 'Nova categoria' }));
    const form = screen.getByRole('form', { name: 'Nova categoria' });
    await user.type(within(form).getByLabelText('Nome da categoria'), ' Projetos ');
    await user.selectOptions(within(form).getByLabelText('Público'), 'active');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies[0]).toEqual({
        name: 'Projetos',
        description: null,
        audience: 'active',
        position: 0,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Nova categoria' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Arquivar' }));
    await waitFor(() => expect(bodies[1]).toEqual({ archived: true }));
  });

  it('busca e filtra os tópicos por categoria', async () => {
    const user = userEvent.setup();
    const { routes, queries } = forumRoutes();
    renderApp('/forum', routes);
    await screen.findByRole('link', { name: 'Dúvida sobre o módulo 2' });

    await user.type(screen.getByRole('searchbox', { name: 'Buscar tópicos' }), 'módulo');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('módulo'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Categorias' }), CATEGORY_ID);
    await waitFor(() => expect(queries.at(-1)?.get('categoryId')).toBe(CATEGORY_ID));
  });

  it('instrutor vê o fórum sem a gestão de categorias', async () => {
    const { routes } = forumRoutes({}, 'instructor');
    renderApp('/forum', routes);

    await screen.findByRole('link', { name: 'Dúvida sobre o módulo 2' });
    expect(screen.queryByRole('button', { name: 'Nova categoria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar categoria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arquivar' })).toBeNull();
    const menu = await findMenu();
    expect(within(menu).getByRole('link', { name: 'Fórum' })).toBeTruthy();
  });
});

describe('tópico no admin (/forum/t/:id)', () => {
  it('fixa, fecha e oculta o tópico com motivo; reexibe quando já oculto', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    let detail = forumTopicDetail();
    const { routes } = forumRoutes({
      [`GET /api/v1/forum/topics/${TOPIC_ID}`]: () => detail,
      [`PATCH /api/v1/forum/topics/${TOPIC_ID}`]: async (request: Request) => {
        const body = (await request.json()) as { hidden?: boolean };
        bodies.push(body);
        if (body.hidden) detail = forumTopicDetail({ status: 'hidden' });
        return detail;
      },
    });
    renderApp(`/forum/t/${TOPIC_ID}`, routes);

    await screen.findByRole('heading', { level: 1, name: 'Dúvida sobre o módulo 2' });
    const hide = screen.getByRole('button', { name: 'Ocultar' }) as HTMLButtonElement;
    expect(hide.disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Fixar' }));
    await waitFor(() => expect(bodies[0]).toEqual({ pinned: true }));
    await user.click(screen.getByRole('button', { name: 'Fechar tópico' }));
    await waitFor(() => expect(bodies[1]).toEqual({ closed: true }));

    await user.type(screen.getByLabelText('Motivo'), 'Fora das regras');
    await user.click(screen.getByRole('button', { name: 'Ocultar' }));
    await waitFor(() => expect(bodies[2]).toEqual({ hidden: true, reason: 'Fora das regras' }));

    await user.click(await screen.findByRole('button', { name: 'Reexibir' }));
    await waitFor(() => expect(bodies[3]).toEqual({ hidden: false, reason: 'Fora das regras' }));
  });

  it('oculta uma resposta por iniciativa própria e marca a solução', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const { routes } = forumRoutes({
      'POST /api/v1/moderation/actions': async (request: Request) => {
        bodies.push(await request.json());
        return new Response(null, { status: 201 });
      },
      [`PATCH /api/v1/forum/topics/${TOPIC_ID}`]: async (request: Request) => {
        bodies.push(await request.json());
        return forumTopicDetail();
      },
    });
    renderApp(`/forum/t/${TOPIC_ID}`, routes);

    await screen.findByText('Uma resposta');
    await user.type(screen.getByLabelText('Motivo'), 'Spam');
    await user.click(screen.getByRole('button', { name: 'Ocultar resposta' }));
    await waitFor(() =>
      expect(bodies[0]).toEqual({
        action: 'hide',
        targetType: 'forum_post',
        targetId: POST_ID,
        reason: 'Spam',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Marcar como solução' }));
    await waitFor(() => expect(bodies[1]).toEqual({ solutionPostId: POST_ID }));
  });

  it('instrutor não vê mover de categoria; a recusa da API aparece como erro', async () => {
    const user = userEvent.setup();
    const { routes } = forumRoutes(
      { [`PATCH /api/v1/forum/topics/${TOPIC_ID}`]: problem(403, 'forbidden') },
      'instructor',
    );
    renderApp(`/forum/t/${TOPIC_ID}`, routes);

    await screen.findByRole('heading', { level: 1, name: 'Dúvida sobre o módulo 2' });
    expect(screen.queryByLabelText('Mover para a categoria')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Fixar' }));
    expect(await screen.findByText('Não foi possível carregar o fórum.')).toBeTruthy();
  });
});
