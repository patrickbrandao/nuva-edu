import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, defaultRoutes, problem, type Routes, type StaffRole } from '../../test/api';
import { findAlert, renderApp } from '../../test/render';
import { STUDENT_ID, userDetail } from '../../test/users';

const PATH = `/alunos/${STUDENT_ID}`;
const SESSIONS = {
  items: [
    {
      id: '0193a5b2-0000-7000-8000-0000000000c1',
      site: 'classroom',
      ip: '203.0.113.10',
      browser: 'Chrome',
      os: 'macOS',
      createdAt: '2026-11-20T09:30:00Z',
      lastUsedAt: '2026-11-24T08:00:00Z',
      current: false,
    },
  ],
};

interface Seen {
  bodies: Record<string, unknown>;
  headers: Record<string, Headers>;
}

/** Ficha e sessões do aluno, mais as rotas extras; guarda corpos e cabeçalhos recebidos. */
function open(extra: Routes = {}, role: StaffRole = 'admin', user = userDetail()) {
  const seen: Seen = { bodies: {}, headers: {} };
  const wrap = (routes: Routes): Routes =>
    Object.fromEntries(
      Object.entries(routes).map(([key, handler]) => [
        key,
        async (request: Request) => {
          seen.headers[key] = request.headers;
          const text = await request.clone().text();
          if (text) seen.bodies[key] = JSON.parse(text);
          return typeof handler === 'function'
            ? (handler as (r: Request) => unknown)(request)
            : handler;
        },
      ]),
    ) as Routes;
  const view = renderApp(PATH, {
    ...defaultRoutes(role),
    [`GET /api/v1/users/${STUDENT_ID}`]: user,
    [`GET /api/v1/users/${STUDENT_ID}/sessions`]: SESSIONS,
    ...wrap(extra),
  });
  return { ...view, seen };
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'Bia Aluna' });
const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });
const confirmBox = (name: string | RegExp) => screen.findByRole('alertdialog', { name });

describe('ficha do usuário (/alunos/:id)', () => {
  it('mostra dados, provedores, sessões e a trilha com o nome', async () => {
    renderApp(PATH, {
      ...defaultRoutes(),
      [`GET /api/v1/users/${STUDENT_ID}`]: userDetail(),
      [`GET /api/v1/users/${STUDENT_ID}/sessions`]: SESSIONS,
    });
    await heading();
    expect(screen.getByText('Beatriz Aluna')).toBeTruthy();
    expect(screen.getByText('bia@gmail.test')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(await screen.findByText('Chrome · macOS')).toBeTruthy();
    expect(screen.getByText('IP 203.0.113.10')).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(crumbs).getByRole('link', { name: 'Alunos' }).getAttribute('href')).toBe(
      '/alunos',
    );
    expect(within(crumbs).getByText('Bia Aluna')).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Bia Aluna · Escola Aurora'));
  });

  it('usuário inexistente (404) mostra "não encontrado" com volta à lista', async () => {
    renderApp(PATH, {
      ...defaultRoutes(),
      [`GET /api/v1/users/${STUDENT_ID}`]: () => problem(404, 'not_found'),
    });
    expect(await screen.findByText('Usuário não encontrado')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar aos alunos' }).getAttribute('href')).toBe(
      '/alunos',
    );
  });

  it('erro do servidor mostra erro tratado', async () => {
    renderApp(PATH, {
      ...defaultRoutes(),
      [`GET /api/v1/users/${STUDENT_ID}`]: () => problem(503, 'database_unavailable'),
    });
    expect(within(await findAlert()).getByText('Não foi possível carregar a ficha')).toBeTruthy();
  });

  describe('botões pelo papel', () => {
    it('manager vê editar, suspender e sessões, mas não senha nem papel', async () => {
      open({}, 'manager');
      await heading();
      expect(screen.getByRole('button', { name: 'Editar dados' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Suspender' })).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Encerrar todas as sessões' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Mostrar senha' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Definir senha' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mudar papel' })).toBeNull();
    });

    it('manager na ficha de alguém da equipe não vê editar nem suspender (staff.manage)', async () => {
      open({}, 'manager', userDetail({ role: 'instructor' }));
      await heading();
      expect(screen.queryByRole('button', { name: 'Editar dados' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Suspender' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Sessões abertas' })).toBeNull();
    });

    it('o botão de mostrar senha só aparece com users.password.view', async () => {
      open({}, 'admin');
      await heading();
      expect(screen.getByRole('button', { name: 'Mostrar senha' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Definir senha' })).toBeTruthy();
    });

    it('na própria ficha, sem suspender nem mudar papel', async () => {
      renderApp(`/alunos/${ADMIN_ID}`, {
        ...defaultRoutes(),
        [`GET /api/v1/users/${ADMIN_ID}`]: userDetail({
          id: ADMIN_ID,
          name: 'Ana Admin',
          role: 'admin',
        }),
        [`GET /api/v1/users/${ADMIN_ID}/sessions`]: SESSIONS,
      });
      await screen.findByRole('heading', { level: 1, name: 'Ana Admin' });
      expect(screen.getByRole('button', { name: 'Editar dados' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Suspender' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mudar papel' })).toBeNull();
    });

    it('admin muda o papel pela ficha', async () => {
      const user = userEvent.setup();
      const { seen } = open({
        [`PATCH /api/v1/users/${STUDENT_ID}/role`]: userDetail({ role: 'manager' }),
      });
      await heading();
      await user.click(screen.getByRole('button', { name: 'Mudar papel' }));
      const box = await dialog('Mudar o papel de Bia Aluna');
      await user.click(within(box).getByRole('button', { name: 'Papel: Aluno' }));
      await user.click(within(box).getByRole('option', { name: 'Gerente' }));
      await user.click(within(box).getByRole('button', { name: 'Continuar' }));
      const confirm = await confirmBox('Mudar o papel?');
      expect(within(confirm).getByText(/passa de Aluno para Gerente/)).toBeTruthy();
      await user.click(within(confirm).getByRole('button', { name: 'Mudar papel' }));
      expect(await screen.findByText('Papel alterado para Gerente.')).toBeTruthy();
      expect(seen.bodies[`PATCH /api/v1/users/${STUDENT_ID}/role`]).toEqual({ role: 'manager' });
    });
  });

  describe('editar', () => {
    async function edit(extra: Routes) {
      const user = userEvent.setup();
      const view = open(extra);
      await heading();
      await user.click(screen.getByRole('button', { name: 'Editar dados' }));
      const box = await dialog('Editar Bia Aluna');
      const email = within(box).getByLabelText('E-mail');
      await user.clear(email);
      await user.type(email, 'nova@aluna.test');
      await user.click(within(box).getByRole('button', { name: 'Salvar' }));
      return { ...view, user, box };
    }

    it('envia nome, nome completo, e-mail e version e atualiza a ficha', async () => {
      const { seen } = await edit({
        [`PATCH /api/v1/users/${STUDENT_ID}`]: userDetail({ email: 'nova@aluna.test', version: 4 }),
      });
      expect(await screen.findByText('Dados salvos.')).toBeTruthy();
      expect(seen.bodies[`PATCH /api/v1/users/${STUDENT_ID}`]).toEqual({
        name: 'Bia Aluna',
        fullName: 'Beatriz Aluna',
        email: 'nova@aluna.test',
        version: 3,
      });
      expect(seen.headers[`PATCH /api/v1/users/${STUDENT_ID}`]?.get('X-CSRF-Token')).toBe(
        'csrf-admin',
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getAllByText('nova@aluna.test').length).toBeGreaterThan(0);
    });

    it('version_conflict avisa e oferece recarregar', async () => {
      const { box, user } = await edit({
        [`PATCH /api/v1/users/${STUDENT_ID}`]: () => problem(409, 'version_conflict'),
      });
      expect(
        await within(box).findByText(/alterada por outra pessoa enquanto você editava/),
      ).toBeTruthy();
      await user.click(within(box).getByRole('button', { name: 'Recarregar a ficha' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('email_taken marca o campo de e-mail', async () => {
      const { box } = await edit({
        [`PATCH /api/v1/users/${STUDENT_ID}`]: () => problem(409, 'email_taken'),
      });
      const email = within(box).getByLabelText('E-mail');
      await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
      expect(within(box).getByText('Este e-mail já está cadastrado em outra conta.')).toBeTruthy();
    });

    it('403 da API vira aviso no diálogo', async () => {
      const { box } = await edit({
        [`PATCH /api/v1/users/${STUDENT_ID}`]: () => problem(403, 'permission_denied'),
      });
      expect(await within(box).findByText(/^Seu papel não permite esta ação\./)).toBeTruthy();
    });
  });

  describe('suspender e reativar', () => {
    async function suspend(extra: Routes) {
      const user = userEvent.setup();
      const view = open(extra);
      await heading();
      await user.click(screen.getByRole('button', { name: 'Suspender' }));
      const box = await dialog('Suspender Bia Aluna');
      await user.click(within(box).getByRole('button', { name: 'Tipo: Só publicar' }));
      await user.click(within(box).getByRole('option', { name: 'Total' }));
      await user.click(within(box).getByRole('button', { name: 'Prazo: 7 dias' }));
      await user.click(within(box).getByRole('option', { name: 'Por tempo indeterminado' }));
      await user.type(within(box).getByLabelText('Motivo'), 'spam no fórum');
      await user.click(within(box).getByRole('button', { name: 'Continuar' }));
      const confirm = await confirmBox('Suspender o usuário?');
      expect(within(confirm).getByText('Bia Aluna')).toBeTruthy();
      await user.click(within(confirm).getByRole('button', { name: 'Suspender' }));
      return { ...view, user, box };
    }

    it('exige motivo antes de confirmar', async () => {
      const user = userEvent.setup();
      open();
      await heading();
      await user.click(screen.getByRole('button', { name: 'Suspender' }));
      const box = await dialog('Suspender Bia Aluna');
      await user.click(within(box).getByRole('button', { name: 'Continuar' }));
      expect(within(box).getByText('Preencha este campo.')).toBeTruthy();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('suspende com tipo, motivo e prazo, e a ficha mostra a suspensão', async () => {
      const suspended = userDetail({
        status: 'suspended',
        suspension: {
          kind: 'full',
          reason: 'spam no fórum',
          startsAt: '2026-11-24T10:00:00Z',
          endsAt: null,
          createdBy: { id: ADMIN_ID, name: 'Ana Admin' },
        },
      });
      const { seen } = await suspend({
        [`POST /api/v1/users/${STUDENT_ID}/suspend`]: suspended,
      });
      expect(await screen.findByText('Bia Aluna foi suspenso.')).toBeTruthy();
      expect(seen.bodies[`POST /api/v1/users/${STUDENT_ID}/suspend`]).toEqual({
        kind: 'full',
        reason: 'spam no fórum',
        durationDays: null,
      });
      expect(screen.getByRole('heading', { name: 'Suspensão vigente' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reativar' })).toBeTruthy();
    });

    it.each([
      ['already_suspended', 409, 'O usuário já está suspenso.'],
      ['last_admin', 422, 'Não é possível: esta é a última conta de administrador ativa.'],
      ['self_action_not_allowed', 422, 'Você não pode fazer isso com a sua própria conta.'],
      ['permission_denied', 403, 'Seu papel não permite esta ação.'],
    ])('recusa %s volta ao formulário com o aviso', async (code, status, text) => {
      const { box } = await suspend({
        [`POST /api/v1/users/${STUDENT_ID}/suspend`]: () => problem(status, code),
      });
      expect(await within(box).findByText(new RegExp(text.replace('.', '\\.')))).toBeTruthy();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('reativa com confirmação; not_suspended avisa', async () => {
      const user = userEvent.setup();
      const suspendedUser = userDetail({
        status: 'suspended',
        suspension: {
          kind: 'posting',
          reason: 'x',
          startsAt: '2026-11-24T10:00:00Z',
          endsAt: '2026-12-01T10:00:00Z',
          createdBy: null,
        },
      });
      open(
        { [`POST /api/v1/users/${STUDENT_ID}/reactivate`]: () => problem(409, 'not_suspended') },
        'admin',
        suspendedUser,
      );
      await heading();
      const section = screen.getByRole('heading', { name: 'Suspensão vigente' }).closest('section');
      expect(within(section as HTMLElement).getByText('Sistema')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Reativar' }));
      const confirm = await confirmBox('Reativar o usuário?');
      await user.click(within(confirm).getByRole('button', { name: 'Reativar' }));
      expect(await screen.findByText('O usuário não está suspenso.')).toBeTruthy();
    });

    it('reativa e a ficha volta a ativo', async () => {
      const user = userEvent.setup();
      open(
        { [`POST /api/v1/users/${STUDENT_ID}/reactivate`]: userDetail() },
        'admin',
        userDetail({
          status: 'suspended',
          suspension: {
            kind: 'posting',
            reason: 'x',
            startsAt: '2026-11-24T10:00:00Z',
            endsAt: null,
            createdBy: null,
          },
        }),
      );
      await heading();
      await user.click(screen.getByRole('button', { name: 'Reativar' }));
      await user.click(
        within(await confirmBox('Reativar o usuário?')).getByRole('button', { name: 'Reativar' }),
      );
      expect(await screen.findByText('Bia Aluna foi reativado.')).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Suspender' })).toBeTruthy();
    });
  });

  describe('sessões', () => {
    it('encerra todas com confirmação', async () => {
      const user = userEvent.setup();
      let gone = false;
      renderApp(PATH, {
        ...defaultRoutes(),
        [`GET /api/v1/users/${STUDENT_ID}`]: userDetail(),
        [`GET /api/v1/users/${STUDENT_ID}/sessions`]: () => (gone ? { items: [] } : SESSIONS),
        [`DELETE /api/v1/users/${STUDENT_ID}/sessions`]: () => {
          gone = true;
          return new Response(null, { status: 204 });
        },
      });
      await user.click(await screen.findByRole('button', { name: 'Encerrar todas as sessões' }));
      const confirm = await confirmBox('Encerrar todas as sessões?');
      await user.click(within(confirm).getByRole('button', { name: 'Encerrar sessões' }));
      expect(await screen.findByText('Sessões encerradas.')).toBeTruthy();
      expect(await screen.findByText('Nenhuma sessão aberta')).toBeTruthy();
    });

    it('recusa vira aviso', async () => {
      const user = userEvent.setup();
      open({ [`DELETE /api/v1/users/${STUDENT_ID}/sessions`]: () => problem(404, 'not_found') });
      await user.click(await screen.findByRole('button', { name: 'Encerrar todas as sessões' }));
      await user.click(
        within(await confirmBox('Encerrar todas as sessões?')).getByRole('button', {
          name: 'Encerrar sessões',
        }),
      );
      expect(await screen.findByText(/Usuário não encontrado\. A conta/)).toBeTruthy();
    });
  });

  describe('mostrar senha (ADR 0002)', () => {
    async function reveal(extra: Routes, adminPassword = 'minha-senha') {
      const user = userEvent.setup();
      const view = open(extra);
      await heading();
      await user.click(screen.getByRole('button', { name: 'Mostrar senha' }));
      const box = await dialog('Senha de Bia Aluna');
      expect(within(box).getByText('Esta visualização fica registrada na auditoria')).toBeTruthy();
      await user.type(within(box).getByLabelText('Sua senha de administrador'), adminPassword);
      await user.click(within(box).getByRole('button', { name: 'Ver a senha' }));
      return { ...view, user, box };
    }
    const KEY = `POST /api/v1/users/${STUDENT_ID}/password/reveal`;

    it('pede a senha do admin, mostra o valor e o esquece ao fechar', async () => {
      const { seen, user, box } = await reveal({ [KEY]: { password: 'segredo-da-bia' } });
      expect(await within(box).findByText('segredo-da-bia')).toBeTruthy();
      expect(seen.bodies[KEY]).toEqual({ adminPassword: 'minha-senha' });
      expect(seen.headers[KEY]?.get('X-CSRF-Token')).toBe('csrf-admin');

      await user.click(within(box).getByRole('button', { name: 'Ocultar e fechar' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.textContent).not.toContain('segredo-da-bia');

      // Abrir de novo pede a senha outra vez: nada ficou guardado.
      await user.click(screen.getByRole('button', { name: 'Mostrar senha' }));
      const again = await dialog('Senha de Bia Aluna');
      expect(within(again).getByLabelText('Sua senha de administrador')).toBeTruthy();
      expect(document.body.textContent).not.toContain('segredo-da-bia');
    });

    it('não deixa a senha no cache de consultas nem de mutações', async () => {
      const { box, user, queryClient } = await reveal({ [KEY]: { password: 'segredo-da-bia' } });
      await within(box).findByText('segredo-da-bia');
      const cached = JSON.stringify([
        queryClient
          .getQueryCache()
          .getAll()
          .map((query) => query.state),
        queryClient
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state),
      ]);
      expect(cached).not.toContain('segredo-da-bia');
      expect(cached).not.toContain('minha-senha');
      expect(window.location.href).not.toContain('segredo');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.body.textContent).not.toContain('segredo-da-bia');
    });

    it('sem a senha do admin, não chama a API', async () => {
      const user = userEvent.setup();
      const { fetchMock } = open({ [KEY]: { password: 'x' } });
      await heading();
      await user.click(screen.getByRole('button', { name: 'Mostrar senha' }));
      const box = await dialog('Senha de Bia Aluna');
      await user.click(within(box).getByRole('button', { name: 'Ver a senha' }));
      expect(within(box).getByText('Preencha este campo.')).toBeTruthy();
      expect(
        fetchMock.mock.calls.some(([input]) => (input as Request).url.includes('/reveal')),
      ).toBe(false);
    });

    it('senha do admin errada marca o campo e limpa o que foi digitado', async () => {
      const { box } = await reveal({
        [KEY]: () => problem(422, 'password_confirmation_invalid'),
      });
      expect(await within(box).findByText(/Senha incorreta\. A tentativa conta/)).toBeTruthy();
      expect(
        (within(box).getByLabelText('Sua senha de administrador') as HTMLInputElement).value,
      ).toBe('');
    });

    it('too_many_attempts diz quando tentar de novo', async () => {
      const { box } = await reveal({
        [KEY]: () => problem(429, 'too_many_attempts', {}, { 'Retry-After': '120' }),
      });
      expect(await within(box).findByText(/Tente de novo em 2 minutos/)).toBeTruthy();
    });

    it('usuário sem senha', async () => {
      const { box } = await reveal({ [KEY]: { password: null } });
      expect(await within(box).findByText('Este usuário não tem senha definida.')).toBeTruthy();
    });

    it('403 da API (papel mudou) vira aviso', async () => {
      const { box } = await reveal({ [KEY]: () => problem(403, 'permission_denied') });
      expect(await within(box).findByText(/^Seu papel não permite esta ação\./)).toBeTruthy();
    });
  });

  describe('definir senha', () => {
    const KEY = `PUT /api/v1/users/${STUDENT_ID}/password`;

    async function setPassword(extra: Routes, value: string) {
      const user = userEvent.setup();
      const view = open(extra);
      await heading();
      await user.click(screen.getByRole('button', { name: 'Definir senha' }));
      const box = await dialog('Definir a senha de Bia Aluna');
      await user.type(within(box).getByLabelText('Senha nova'), value);
      await user.click(within(box).getByRole('button', { name: 'Continuar' }));
      return { ...view, user, box };
    }

    it('recusa senha curta no navegador', async () => {
      const { box } = await setPassword({}, 'curta');
      expect(within(box).getByText('A senha precisa ter de 8 a 128 caracteres.')).toBeTruthy();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('confirma e define', async () => {
      const { seen, user } = await setPassword(
        { [KEY]: () => new Response(null, { status: 204 }) },
        'senha-nova-123',
      );
      const confirm = await confirmBox('Definir a senha?');
      await user.click(within(confirm).getByRole('button', { name: 'Definir senha' }));
      expect(await screen.findByText('Senha definida.')).toBeTruthy();
      expect(seen.bodies[KEY]).toEqual({ password: 'senha-nova-123' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('password_invalid da API marca o campo', async () => {
      const { user, box } = await setPassword(
        { [KEY]: () => problem(400, 'password_invalid') },
        'senha-nova-123',
      );
      await user.click(
        within(await confirmBox('Definir a senha?')).getByRole('button', { name: 'Definir senha' }),
      );
      await waitFor(() =>
        expect(within(box).getByLabelText('Senha nova').getAttribute('aria-invalid')).toBe('true'),
      );
    });
  });
});
