import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, defaultRoutes, problem, type Routes, sessionFor } from '../../test/api';
import { findAlert, findMenu, renderApp } from '../../test/render';
import { userDetail, userSummary } from '../../test/users';

const ANA = userSummary({
  id: ADMIN_ID,
  name: 'Ana Admin',
  email: 'admin@escola.test',
  role: 'admin',
});
const GIL = userSummary({
  id: '0193a5b2-0000-7000-8000-0000000000d1',
  name: 'Gil Gerente',
  email: 'gil@escola.test',
  role: 'manager',
});
const IVO = userSummary({
  id: '0193a5b2-0000-7000-8000-0000000000d2',
  name: 'Ivo Instrutor',
  email: 'ivo@escola.test',
  role: 'instructor',
  status: 'suspended',
});

function team(extra: Routes = {}) {
  const roles: string[] = [];
  const bodies: Record<string, unknown> = {};
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/users': (request: Request) => {
      const role = new URL(request.url).searchParams.get('role') ?? '';
      roles.push(role);
      const items = { admin: [ANA], manager: [GIL], instructor: [IVO] }[role] ?? [];
      return { items, nextCursor: null };
    },
  };
  for (const [key, handler] of Object.entries(extra)) {
    routes[key] = async (request: Request) => {
      const text = await request.clone().text();
      if (text) bodies[key] = JSON.parse(text);
      return typeof handler === 'function'
        ? (handler as (r: Request) => unknown)(request)
        : handler;
    };
  }
  return { routes, roles, bodies };
}

describe('equipe (/equipe)', () => {
  it('lista administradores, gerentes e instrutores, consultando cada papel', async () => {
    const { routes, roles } = team();
    renderApp('/equipe', routes);
    const table = (await screen.findByRole('table')) as HTMLElement;
    const names = within(table)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(['Ana Admin', 'Gil Gerente', 'Ivo Instrutor']);
    expect(new Set(roles)).toEqual(new Set(['admin', 'manager', 'instructor']));
    // A própria linha não tem ações.
    expect(within(table).getByText('Você')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Suspender Ana Admin' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reativar Ivo Instrutor' })).toBeTruthy();
  });

  it('manager não abre a equipe (staff.manage) e não consulta', async () => {
    const { routes, roles } = team();
    renderApp('/equipe', {
      ...routes,
      'GET /api/v1/session': sessionFor('manager'),
    });
    await findMenu();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(roles).toHaveLength(0);
  });

  it('erro da lista é tratado', async () => {
    renderApp('/equipe', {
      ...defaultRoutes(),
      'GET /api/v1/users': () => problem(500, 'internal_error'),
    });
    expect(within(await findAlert()).getByText('Não foi possível carregar a equipe')).toBeTruthy();
  });

  describe('criar membro', () => {
    async function create(extra: Routes, password = 'senha-inicial-1') {
      const user = userEvent.setup();
      const view = team(extra);
      renderApp('/equipe', view.routes);
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Novo membro' }));
      const box = await screen.findByRole('dialog', { name: 'Novo membro da equipe' });
      await user.type(within(box).getByLabelText('Nome de exibição'), 'Rui Novo');
      await user.type(within(box).getByLabelText('E-mail'), 'rui@escola.test');
      await user.click(within(box).getByRole('button', { name: 'Papel: Instrutor' }));
      await user.click(within(box).getByRole('option', { name: 'Gerente' }));
      await user.type(within(box).getByLabelText('Senha inicial'), password);
      await user.click(within(box).getByRole('button', { name: 'Criar conta' }));
      return { ...view, user, box };
    }

    it('cria com nome, e-mail, papel e senha', async () => {
      const { bodies } = await create({
        'POST /api/v1/users': () =>
          new Response(JSON.stringify(userDetail({ name: 'Rui Novo', role: 'manager' })), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
      });
      expect(await screen.findByText('Conta de Rui Novo criada.')).toBeTruthy();
      expect(bodies['POST /api/v1/users']).toEqual({
        name: 'Rui Novo',
        email: 'rui@escola.test',
        role: 'manager',
        password: 'senha-inicial-1',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('senha curta é recusada no navegador', async () => {
      const { box } = await create({}, 'curta');
      expect(within(box).getByText('A senha precisa ter de 8 a 128 caracteres.')).toBeTruthy();
    });

    it('email_taken marca o e-mail', async () => {
      const { box } = await create({ 'POST /api/v1/users': () => problem(409, 'email_taken') });
      expect(
        await within(box).findByText('Este e-mail já está cadastrado em outra conta.'),
      ).toBeTruthy();
      expect(within(box).getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
    });

    it('password_invalid marca a senha', async () => {
      const { box } = await create({
        'POST /api/v1/users': () => problem(400, 'password_invalid'),
      });
      await waitFor(() =>
        expect(within(box).getByLabelText('Senha inicial').getAttribute('aria-invalid')).toBe(
          'true',
        ),
      );
    });

    it('validation_failed marca os campos citados', async () => {
      const { box } = await create({
        'POST /api/v1/users': () =>
          problem(400, 'validation_failed', { errors: [{ path: 'body.name', message: 'x' }] }),
      });
      expect(await within(box).findByText('Confira os campos e tente de novo.')).toBeTruthy();
      expect(within(box).getByLabelText('Nome de exibição').getAttribute('aria-invalid')).toBe(
        'true',
      );
    });
  });

  describe('mudar papel', () => {
    async function changeRole(extra: Routes) {
      const user = userEvent.setup();
      const view = team(extra);
      renderApp('/equipe', view.routes);
      await user.click(await screen.findByRole('button', { name: 'Mudar papel de Gil Gerente' }));
      const box = await screen.findByRole('dialog', { name: 'Mudar o papel de Gil Gerente' });
      await user.click(within(box).getByRole('button', { name: 'Papel: Gerente' }));
      await user.click(within(box).getByRole('option', { name: 'Aluno' }));
      await user.click(within(box).getByRole('button', { name: 'Continuar' }));
      const confirm = await screen.findByRole('alertdialog', { name: 'Mudar o papel?' });
      await user.click(within(confirm).getByRole('button', { name: 'Mudar papel' }));
      return { ...view, box };
    }
    const KEY = `PATCH /api/v1/users/${GIL.id}/role`;

    it('muda e avisa', async () => {
      const { bodies } = await changeRole({ [KEY]: userDetail({ ...GIL, role: 'student' }) });
      expect(await screen.findByText('Papel alterado para Aluno.')).toBeTruthy();
      expect(bodies[KEY]).toEqual({ role: 'student' });
    });

    it.each([
      ['last_admin', 'Não é possível: esta é a última conta de administrador ativa.'],
      ['self_action_not_allowed', 'Você não pode fazer isso com a sua própria conta.'],
    ])('%s volta ao diálogo com o aviso', async (code, text) => {
      const { box } = await changeRole({ [KEY]: () => problem(422, code) });
      expect(await within(box).findByText(text)).toBeTruthy();
    });
  });

  it('suspende alguém da equipe pela lista', async () => {
    const user = userEvent.setup();
    const { routes } = team({
      [`POST /api/v1/users/${GIL.id}/suspend`]: userDetail({ ...GIL, status: 'suspended' }),
    });
    renderApp('/equipe', routes);
    await user.click(await screen.findByRole('button', { name: 'Suspender Gil Gerente' }));
    const box = await screen.findByRole('dialog', { name: 'Suspender Gil Gerente' });
    await user.type(within(box).getByLabelText('Motivo'), 'saiu da escola');
    await user.click(within(box).getByRole('button', { name: 'Continuar' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Suspender' }),
    );
    expect(await screen.findByText('Gil Gerente foi suspenso.')).toBeTruthy();
  });
});
