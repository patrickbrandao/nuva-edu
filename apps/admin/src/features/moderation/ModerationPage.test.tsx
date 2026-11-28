import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, type Routes, type StaffRole } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  AUTHOR_ID,
  moderationRecord,
  POST_ID,
  queueDetail,
  queueItem,
  TOPIC_ID,
} from '../../test/forum';
import { findAlert, renderApp } from '../../test/render';
import { STUDENT_ID, userDetail } from '../../test/users';

const CASE = `/denuncias/forum_post/${POST_ID}`;
const CASE_API = `GET /api/v1/moderation/queue/forum_post/${POST_ID}`;

function open(path: string, extra: Routes = {}, role: StaffRole = 'admin') {
  const queries: URLSearchParams[] = [];
  const bodies: Record<string, unknown> = {};
  const wrapped = Object.fromEntries(
    Object.entries(extra).map(([key, handler]) => [
      key,
      async (request: Request) => {
        const text = await request.clone().text();
        if (text) bodies[key] = JSON.parse(text);
        return typeof handler === 'function'
          ? (handler as (r: Request) => unknown)(request)
          : handler;
      },
    ]),
  ) as Routes;
  const view = renderApp(path, {
    ...defaultRoutes(role),
    'GET /api/v1/moderation/queue': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return { items: [queueItem()], nextCursor: null };
    },
    [CASE_API]: queueDetail(),
    ...wrapped,
  });
  return { ...view, queries, bodies };
}

const created = () => new Response(null, { status: 201 });

describe('fila de denúncias (/denuncias)', () => {
  it('mostra os itens agrupados com a contagem de denunciantes, sem violações do axe', async () => {
    const { queries } = open('/denuncias');

    const link = await screen.findByRole('link', { name: 'Dúvida sobre o módulo 2' });
    expect(link.getAttribute('href')).toBe(CASE);
    expect(screen.getByText(/Caio Colega · 2 denunciantes/)).toBeTruthy();
    expect(queries[0]?.get('status')).toBe('open');
    await expectNoAxeViolations();
  });

  it('filtra por estado, motivo e tipo de conteúdo', async () => {
    const user = userEvent.setup();
    const { queries } = open('/denuncias');
    await screen.findByRole('link', { name: 'Dúvida sobre o módulo 2' });

    await user.selectOptions(screen.getByLabelText('Estado'), 'resolved');
    await user.selectOptions(screen.getByLabelText('Motivo'), 'piracy');
    await user.selectOptions(screen.getByLabelText('Tipo de conteúdo'), 'forum_topic');
    await waitFor(() => expect(queries.at(-1)?.get('targetType')).toBe('forum_topic'));
    expect(queries.at(-1)?.get('status')).toBe('resolved');
    expect(queries.at(-1)?.get('reason')).toBe('piracy');
  });

  it('fila vazia mostra o aviso; denúncia contra a equipe não chega ao gerente', async () => {
    open(
      '/denuncias',
      { 'GET /api/v1/moderation/queue': { items: [], nextCursor: null } },
      'manager',
    );
    expect(await screen.findByText('Nenhuma denúncia neste filtro.')).toBeTruthy();
  });

  it('caso que a API recusa (denúncia contra a equipe, para o gerente) mostra erro sem ações', async () => {
    open(CASE, { [CASE_API]: problem(404, 'not_found') }, 'manager');

    expect(await screen.findByText('Não foi possível carregar o fórum.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).toBeNull();
  });
});

describe('caso denunciado (/denuncias/:tipo/:id)', () => {
  it('mostra conteúdo, contexto, denunciantes, motivos e histórico', async () => {
    open(CASE, { [CASE_API]: queueDetail({}, [moderationRecord({ action: 'hide' })]) });

    const region = await screen.findByRole('article', { name: 'Conteúdo denunciado: Resposta' });
    expect(within(region).getByText('Texto denunciado')).toBeTruthy();
    const reporters = screen.getByRole('region', { name: 'Denunciantes' });
    expect(within(reporters).getByText('Dora Denunciante')).toBeTruthy();
    expect(within(reporters).getByText('Enzo Estudante')).toBeTruthy();
    expect(within(reporters).getByText('Ofendeu um colega')).toBeTruthy();
    expect(
      within(region).getByRole('link', { name: 'Dúvida sobre o módulo 2' }).getAttribute('href'),
    ).toBe(`/forum/t/${TOPIC_ID}`);
    expect(screen.getByText('Conteúdo ocultado')).toBeTruthy();
    expect(screen.getByText(/Linguagem ofensiva/)).toBeTruthy();
    expect(screen.getByText(/Moderador: Gil Gerente/)).toBeTruthy();
  });

  it('oculta com motivo e, já oculto, oferece reexibir', async () => {
    const user = userEvent.setup();
    let detail = queueDetail();
    const { bodies } = open(CASE, {
      [CASE_API]: () => detail,
      'POST /api/v1/moderation/actions': () => {
        detail = queueDetail({ hidden: true });
        return created();
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Ocultar' }));
    const save = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByLabelText('Motivo'), 'Spam repetido');
    await user.click(save);
    await waitFor(() =>
      expect(bodies['POST /api/v1/moderation/actions']).toEqual({
        action: 'hide',
        targetType: 'forum_post',
        targetId: POST_ID,
        reason: 'Spam repetido',
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Reexibir' }));
    await user.type(screen.getByLabelText('Motivo'), 'Analisado');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies['POST /api/v1/moderation/actions']).toMatchObject({
        action: 'unhide',
        reason: 'Analisado',
      }),
    );
  });

  it('edita o conteúdo e descarta a denúncia', async () => {
    const user = userEvent.setup();
    const { bodies } = open(CASE, { 'POST /api/v1/moderation/actions': created });

    await user.click(await screen.findByRole('button', { name: 'Editar conteúdo' }));
    await user.type(screen.getByLabelText('Motivo'), 'Remove link');
    await user.type(screen.getByLabelText('Mensagem'), 'Texto sem o link');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies['POST /api/v1/moderation/actions']).toMatchObject({
        action: 'edit',
        bodyMd: 'Texto sem o link',
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Descartar denúncia' }));
    await user.type(screen.getByLabelText('Motivo'), 'Improcedente');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies['POST /api/v1/moderation/actions']).toMatchObject({ action: 'dismiss' }),
    );
  });

  it('adverte e suspende o autor pelas rotas do usuário', async () => {
    const user = userEvent.setup();
    const { bodies } = open(CASE, {
      [`POST /api/v1/users/${AUTHOR_ID}/warn`]: created,
      [`POST /api/v1/users/${AUTHOR_ID}/suspend`]: () => userDetail({ id: AUTHOR_ID }),
    });

    await user.click(await screen.findByRole('button', { name: 'Advertir autor' }));
    await user.type(screen.getByLabelText('Motivo'), 'Ofensa a colega');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies[`POST /api/v1/users/${AUTHOR_ID}/warn`]).toEqual({ reason: 'Ofensa a colega' }),
    );

    await user.click(await screen.findByRole('button', { name: 'Suspender autor' }));
    await user.type(screen.getByLabelText('Motivo'), 'Reincidência');
    await user.selectOptions(screen.getByLabelText('Tipo de conteúdo'), 'full');
    await user.selectOptions(screen.getByLabelText('Prazo'), '30');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies[`POST /api/v1/users/${AUTHOR_ID}/suspend`]).toEqual({
        reason: 'Reincidência',
        kind: 'full',
        durationDays: 30,
      }),
    );
  });

  it('instrutor só oculta, reexibe e fecha: sem editar, descartar, advertir ou suspender', async () => {
    open(
      `/denuncias/forum_topic/${TOPIC_ID}`,
      {
        [`GET /api/v1/moderation/queue/forum_topic/${TOPIC_ID}`]: queueDetail({
          targetType: 'forum_topic',
          targetId: TOPIC_ID,
        }),
      },
      'instructor',
    );

    expect(await screen.findByRole('button', { name: 'Ocultar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar tópico' })).toBeTruthy();
    for (const name of [
      'Editar conteúdo',
      'Descartar denúncia',
      'Advertir autor',
      'Suspender autor',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('recusa da API (gerente agindo sobre conta da equipe) aparece como aviso', async () => {
    const user = userEvent.setup();
    open(CASE, { [`POST /api/v1/users/${AUTHOR_ID}/warn`]: problem(403, 'forbidden') }, 'manager');

    await user.click(await screen.findByRole('button', { name: 'Advertir autor' }));
    await user.type(screen.getByLabelText('Motivo'), 'Teste');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await findAlert()).textContent).toContain('Não foi possível');
  });

  it('tipo de alvo desconhecido no endereço mostra erro sem chamar a API', async () => {
    open(`/denuncias/case/${POST_ID}`);
    expect(await screen.findByText('Não foi possível carregar o fórum.')).toBeTruthy();
  });
});

describe('histórico de moderação na ficha do usuário', () => {
  const routes = (role: StaffRole, extra: Routes = {}) =>
    open(
      `/alunos/${STUDENT_ID}`,
      {
        [`GET /api/v1/users/${STUDENT_ID}`]: userDetail(),
        [`GET /api/v1/users/${STUDENT_ID}/sessions`]: { items: [] },
        [`GET /api/v1/users/${STUDENT_ID}/moderation-history`]: {
          items: [moderationRecord()],
          nextCursor: null,
        },
        ...extra,
      },
      role,
    );

  it('mostra advertências e suspensões e registra nova advertência', async () => {
    const user = userEvent.setup();
    const { bodies } = routes('manager', { [`POST /api/v1/users/${STUDENT_ID}/warn`]: created });

    const region = await screen.findByRole('region', { name: 'Histórico de moderação' });
    expect(within(region).getByText('Advertência')).toBeTruthy();
    expect(within(region).getByText(/Linguagem ofensiva/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Advertir autor' }));
    await user.type(screen.getByLabelText('Motivo'), 'Segunda ocorrência');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies[`POST /api/v1/users/${STUDENT_ID}/warn`]).toEqual({
        reason: 'Segunda ocorrência',
      }),
    );
  });

  it('gerente não vê o histórico de moderação de conta da equipe', async () => {
    const { fetchMock } = routes('manager', {
      [`GET /api/v1/users/${STUDENT_ID}`]: userDetail({
        role: 'instructor',
        name: 'Ivo Instrutor',
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Ivo Instrutor' });
    expect(screen.queryByText('Histórico de moderação')).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        (input as Request).url.endsWith('/moderation-history'),
      ),
    ).toBe(false);
  });
});
