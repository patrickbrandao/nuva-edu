// Critério de saída da Fase 1 (specs/PLAN.md): cadastro por senha, confirmação do e-mail e
// redefinição da senha, com os e-mails conferidos no Mailpit (spec 007, "Cadastro por e-mail e
// senha", "Confirmação de e-mail", "Definir, trocar e redefinir senha").
import { expect, test } from '@playwright/test';
import { isolatedLogin, testPassword, uniqueEmail } from '../../support/accounts.ts';
import { CLASSROOM_URL } from '../../support/env.ts';
import { linkIn, SUBJECTS, waitForMail } from '../../support/mailpit.ts';
import { pace } from '../../support/pacing.ts';
import {
  classroomSession,
  passwordField,
  signInClassroom,
  signOutClassroom,
  signUpWithPassword,
} from '../../support/ui.ts';

test('cadastro por senha, confirmação do e-mail e redefinição da senha', async ({ page }) => {
  const account = { name: 'Aluna Senha', email: uniqueEmail('senha'), password: testPassword() };

  await test.step('cadastro entra na conta, ainda sem e-mail confirmado', async () => {
    await signUpWithPassword(page, account);
    await expect(page.getByText('Confirme o seu e-mail', { exact: true })).toBeVisible();
    expect((await classroomSession(page)).body.user.emailVerified).toBe(false);
  });

  await test.step('o link do e-mail de confirmação confirma o e-mail', async () => {
    const mail = await waitForMail(account.email, SUBJECTS.verify);
    await page.goto(linkIn(mail, '/confirmar'));
    await expect(page.getByText('E-mail confirmado', { exact: true })).toBeVisible();
    expect((await classroomSession(page)).body.user.emailVerified).toBe(true);
  });

  await test.step('sai e pede a redefinição em "Esqueci a senha"', async () => {
    await page.goto(`${CLASSROOM_URL}/inicio`);
    await signOutClassroom(page, account.name);
    await page.goto(`${CLASSROOM_URL}/entrar`);
    await page.getByRole('link', { name: 'Esqueci a senha' }).click();
    await expect(page).toHaveURL(/\/redefinir$/);
    await page.getByLabel('E-mail', { exact: true }).fill(account.email);
    await pace('classroom');
    await page.getByRole('button', { name: 'Enviar o link' }).click();
    await expect(page.getByText('Confira o seu e-mail', { exact: true })).toBeVisible();
  });

  const newPassword = testPassword();
  let resetLink = '';
  await test.step('o link do e-mail de redefinição grava a senha nova', async () => {
    resetLink = linkIn(await waitForMail(account.email, SUBJECTS.reset), '/redefinir');
    await page.goto(resetLink);
    await passwordField(page, 'Nova senha').fill(newPassword);
    await pace('classroom');
    await page.getByRole('button', { name: 'Salvar a nova senha' }).click();
    await expect(page).toHaveURL(/\/entrar\?/);
    await expect(page.getByText('Senha redefinida. Entre com a nova senha.')).toBeVisible();
  });

  await test.step('entra com a senha nova; a antiga deixa de valer', async () => {
    await signInClassroom(page, account.email, newPassword);
    await expect(page).toHaveURL(/\/inicio$/);
    const old = await isolatedLogin('classroom-api', account.email, account.password);
    expect(old.status, 'login com a senha anterior à redefinição').toBe(401);
    expect(old.body).toMatchObject({ code: 'invalid_credentials' });
  });

  await test.step('o link de redefinição já usado não vale de novo', async () => {
    await signOutClassroom(page, account.name);
    await page.goto(resetLink);
    await passwordField(page, 'Nova senha').fill(testPassword());
    await pace('classroom');
    await page.getByRole('button', { name: 'Salvar a nova senha' }).click();
    await expect(page.getByText('Link vencido ou já usado', { exact: true })).toBeVisible();
    const still = await isolatedLogin('classroom-api', account.email, newPassword);
    expect(still.status, 'a senha nova continua valendo').toBe(200);
  });
});
