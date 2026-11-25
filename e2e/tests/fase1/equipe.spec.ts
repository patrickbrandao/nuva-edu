// Critério de saída da Fase 1, lado do painel: admin inicial das variáveis, equipe criada pelo
// admin, suspensão, exibição da senha com auditoria e o que gerente e instrutor não veem
// (spec 007, "Admin inicial", "Equipe criada pelo admin", "Exibição da senha"; spec 008; spec 028).
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  isolatedLogin,
  registerStudent,
  type Student,
  signInContext,
  testPassword,
  uniqueEmail,
} from '../../support/accounts.ts';
import { ADMIN_STATE } from '../../support/auth-state.ts';
import { adminCredentials } from '../../support/credentials.ts';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import { accountMenu, passwordField, signInAdmin, signInClassroom } from '../../support/ui.ts';

/** Abre a ficha do aluno pela busca da lista "Alunos"; devolve o id do usuário. */
async function openStudent(page: Page, student: Pick<Student, 'name' | 'email'>): Promise<string> {
  await page.goto(`${ADMIN_URL}/alunos?q=${encodeURIComponent(student.email)}`);
  await page.getByRole('link', { name: student.name, exact: true }).click();
  await expect(page).toHaveURL(/\/alunos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: student.name })).toBeVisible();
  return page.url().split('/').pop() as string;
}

/** Página do painel com a sessão de um membro da equipe aberta pela rede interna. */
async function staffPage(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext();
  await signInContext(context, 'admin-api', email, password);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  return page;
}

async function adminApi(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const session = await page.request.get(`${ADMIN_URL}/api/v1/session`);
  expect(session.status()).toBe(200);
  const { csrfToken } = await session.json();
  return page.request.fetch(`${ADMIN_URL}${path}`, {
    method,
    headers: { 'x-csrf-token': csrfToken },
    ...(data === undefined ? {} : { data }),
  });
}

test('o admin inicial entra com ADMIN_EMAIL e ADMIN_PASSWORD', async ({ page }) => {
  const { email, password } = adminCredentials();
  await signInAdmin(page, email, password);
  await expect(page).toHaveURL(`${ADMIN_URL}/`);
  await expect(page.getByText('Administrador', { exact: true })).toBeVisible();
  const session = await (await page.request.get(`${ADMIN_URL}/api/v1/session`)).json();
  expect(session.user).toMatchObject({ email, role: 'admin' });
});

test.describe('com a sessão do admin inicial', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

  test('cria gerente e instrutor; o gerente não vê senha nem auditoria; o instrutor não vê alunos', async ({
    page,
    browser,
  }) => {
    const members = {
      manager: {
        name: 'Gerente E2E',
        email: uniqueEmail('gerente'),
        password: testPassword(),
        role: 'Gerente',
      },
      instructor: {
        name: 'Instrutor E2E',
        email: uniqueEmail('instrutor'),
        password: testPassword(),
        role: 'Instrutor',
      },
    };

    for (const member of Object.values(members)) {
      await test.step(`o admin cria ${member.role.toLowerCase()} em Equipe`, async () => {
        await page.goto(`${ADMIN_URL}/equipe`);
        await page.getByRole('button', { name: 'Novo membro' }).click();
        const dialog = page.getByRole('dialog', { name: 'Novo membro da equipe' });
        await dialog.getByLabel('Nome de exibição').fill(member.name);
        await dialog.getByLabel('E-mail', { exact: true }).fill(member.email);
        await dialog.getByRole('button', { name: /^Papel:/ }).click();
        await page.getByRole('option', { name: member.role, exact: true }).click();
        await passwordField(dialog, 'Senha inicial').fill(member.password);
        await dialog.getByRole('button', { name: 'Criar conta' }).click();
        await expect(page.getByText(`Conta de ${member.name} criada.`)).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('row').filter({ hasText: member.email })).toContainText(
          member.role,
        );
      });
    }

    const student = await registerStudent('gerente-alvo');
    const studentId = await openStudent(page, student);
    await expect(page.getByRole('button', { name: 'Mostrar senha' })).toBeVisible();

    await test.step('gerente: sem "Auditoria" no menu, sem "Mostrar senha", 403 nas duas rotas', async () => {
      const manager = await staffPage(browser, members.manager.email, members.manager.password);
      await manager.goto(ADMIN_URL);
      const menu = manager.getByRole('navigation', { name: /^Menu/ });
      await expect(menu.getByRole('link', { name: 'Alunos', exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Auditoria', exact: true })).toHaveCount(0);
      await openStudent(manager, student);
      await expect(manager.getByRole('button', { name: 'Suspender' })).toBeVisible();
      await expect(manager.getByRole('button', { name: 'Mostrar senha' })).toHaveCount(0);
      const audit = await manager.request.get(`${ADMIN_URL}/api/v1/audit`);
      expect(audit.status(), 'GET /api/v1/audit como gerente').toBe(403);
      const reveal = await adminApi(manager, 'POST', `/api/v1/users/${studentId}/password/reveal`, {
        adminPassword: members.manager.password,
      });
      expect(reveal.status(), 'POST .../password/reveal como gerente').toBe(403);
      expect(await reveal.text()).not.toContain(student.password);
      await manager.goto(`${ADMIN_URL}/auditoria`);
      await expect(manager.getByText('Sem permissão', { exact: true })).toBeVisible();
      await manager.context().close();
    });

    await test.step('instrutor: sem "Alunos" no menu', async () => {
      const instructor = await staffPage(
        browser,
        members.instructor.email,
        members.instructor.password,
      );
      await instructor.goto(ADMIN_URL);
      const menu = instructor.getByRole('navigation', { name: /^Menu/ });
      await expect(menu.getByRole('link', { name: 'Painel', exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Alunos', exact: true })).toHaveCount(0);
      await instructor.goto(`${ADMIN_URL}/alunos`);
      await expect(instructor.getByText('Sem permissão', { exact: true })).toBeVisible();
      await instructor.context().close();
    });
  });

  test('suspender um aluno derruba a sessão dele e recusa o login; reativar devolve', async ({
    page,
    browser,
  }) => {
    const student = await registerStudent('suspenso');
    const studentContext = await browser.newContext();
    await signInContext(studentContext, 'classroom-api', student.email, student.password);
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${CLASSROOM_URL}/inicio`);
    await expect(accountMenu(studentPage, student.name)).toBeVisible();

    await test.step('o admin suspende por completo', async () => {
      await openStudent(page, student);
      await page.getByRole('button', { name: 'Suspender' }).click();
      const dialog = page.getByRole('dialog', { name: `Suspender ${student.name}` });
      await dialog.getByRole('button', { name: /^Tipo:/ }).click();
      await page.getByRole('option', { name: 'Total', exact: true }).click();
      await dialog.getByLabel('Motivo').fill('Teste de ponta a ponta da suspensão.');
      await dialog.getByRole('button', { name: 'Continuar' }).click();
      const confirm = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog', { name: 'Suspender o usuário?' }));
      await confirm.getByRole('button', { name: 'Suspender', exact: true }).click();
      await expect(page.getByText(`${student.name} foi suspenso.`)).toBeVisible();
    });

    await test.step('a sessão do aluno cai e o login é recusado', async () => {
      await studentPage.reload();
      await expect(accountMenu(studentPage, student.name)).toBeHidden();
      expect((await studentPage.request.get(`${CLASSROOM_URL}/api/v1/session`)).status()).toBe(401);
      await signInClassroom(studentPage, student.email, student.password);
      await expect(
        studentPage.getByText('Esta conta está suspensa.', { exact: false }),
      ).toBeVisible();
    });

    await test.step('o admin reativa e o aluno volta a entrar', async () => {
      await page.getByRole('button', { name: 'Reativar' }).click();
      const confirm = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog', { name: 'Reativar o usuário?' }));
      await confirm.getByRole('button', { name: 'Reativar', exact: true }).click();
      await expect(page.getByText(`${student.name} foi reativado.`)).toBeVisible();
      expect((await isolatedLogin('classroom-api', student.email, student.password)).status).toBe(
        200,
      );
    });
    await studentContext.close();
  });

  test('o admin vê a senha de um usuário e a visualização fica na auditoria', async ({ page }) => {
    const student = await registerStudent('senha-vista');
    const userId = await openStudent(page, student);

    await test.step('"Mostrar senha" com a confirmação da senha do admin', async () => {
      await page.getByRole('button', { name: 'Mostrar senha' }).click();
      const dialog = page.getByRole('dialog', { name: `Senha de ${student.name}` });
      await passwordField(dialog, 'Sua senha de administrador').fill(adminCredentials().password);
      await dialog.getByRole('button', { name: 'Ver a senha' }).click();
      const value = dialog
        .getByRole('status', { name: 'Senha do usuário' })
        .or(dialog.locator('output'));
      // Sem o valor na mensagem de falha: comparação por igualdade, não por texto exibido.
      expect(
        (await value.textContent())?.trim() === student.password,
        'senha exibida confere',
      ).toBe(true);
      await dialog.getByRole('button', { name: 'Ocultar e fechar' }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step('a auditoria tem user.password_view com o usuário como alvo', async () => {
      await page.goto(
        `${ADMIN_URL}/auditoria?action=user.password_view&targetType=user&targetId=${userId}`,
      );
      await expect(
        page.getByRole('link', { name: /^Abrir o registro user\.password_view de / }),
      ).toHaveCount(1);
      const entries = await (
        await page.request.get(
          `${ADMIN_URL}/api/v1/audit?action=user.password_view&targetType=user&targetId=${userId}`,
        )
      ).json();
      const text = JSON.stringify(entries);
      expect(text.includes(student.password), 'a auditoria não grava o valor da senha').toBe(false);
    });
  });
});
