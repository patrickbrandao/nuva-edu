// Critério de saída da Fase 1: cadastro e login por Google, Facebook e Apple, contra o provedor
// simulado (ADR 0024; spec 007, "Login social e vínculo", "Fluxo do provedor", "Cadastro
// pendente").
import { expect, test } from '@playwright/test';
import {
  isolatedLogin,
  registerStudent,
  uniqueEmail,
  uniqueSubject,
} from '../../support/accounts.ts';
import { isolatedRequest } from '../../support/isolated.ts';
import { linkIn, SUBJECTS, waitForMail } from '../../support/mailpit.ts';
import {
  accountMenu,
  classroomSession,
  completeSocialSignup,
  decideAtProvider,
  PROVIDER_NAMES,
  type Provider,
  startSocial,
} from '../../support/ui.ts';

const PROVIDERS: Provider[] = ['google', 'facebook', 'apple'];

for (const provider of PROVIDERS) {
  const providerName = PROVIDER_NAMES[provider];

  test.describe(`login social: ${providerName}`, () => {
    test('conta nova: aceite no cadastro pendente e entrada já com e-mail confirmado', async ({
      page,
    }) => {
      const email = uniqueEmail(`${provider}-novo`);
      const name = `Aluno ${providerName} Novo`;
      await startSocial(page, provider);
      await decideAtProvider(page, { sub: uniqueSubject(provider), email, name });
      await completeSocialSignup(page);
      await expect(page).toHaveURL(/\/inicio$/);
      const { body } = await classroomSession(page);
      expect(body.user).toMatchObject({ email, emailVerified: true });
      // Apple só manda o nome no campo `user` da primeira autorização, que o simulador envia.
      await expect(accountMenu(page, body.user.name)).toBeVisible();
    });

    test('e-mail verificado de conta não confirmada: vincula, entra e a senha antiga cai', async ({
      page,
    }) => {
      const student = await registerStudent(`${provider}-existe`);
      await startSocial(page, provider);
      await decideAtProvider(page, {
        sub: uniqueSubject(provider),
        email: student.email,
        name: 'Outro Nome',
      });
      await expect(page).toHaveURL(/\/inicio$/);
      const { body } = await classroomSession(page);
      expect(body.user).toMatchObject({ email: student.email, emailVerified: true });
      expect(body.user.name, 'entra na conta que já existia').toBe(student.name);
      const old = await isolatedLogin('classroom-api', student.email, student.password);
      expect(old.status, 'a senha definida antes da confirmação deixa de valer').toBe(401);
    });

    test('recusa no provedor volta à tela de entrada com o aviso', async ({ page }) => {
      await startSocial(page, provider);
      await decideAtProvider(page, {
        sub: uniqueSubject(provider),
        email: uniqueEmail(`${provider}-recusa`),
        decision: 'Recusar',
      });
      await expect(page).toHaveURL(/\/entrar\?erro=oauth_denied/);
      await expect(
        page.getByText('O acesso foi recusado no provedor.', { exact: false }),
      ).toBeVisible();
      expect((await classroomSession(page)).status).toBe(401);
    });
  });
}

test('Apple com e-mail oculto: conta própria com o e-mail de retransmissão', async ({ page }) => {
  await startSocial(page, 'apple');
  await decideAtProvider(page, {
    sub: uniqueSubject('apple-oculto'),
    email: uniqueEmail('apple-oculto'),
    name: 'Aluno Apple Oculto',
    hideEmail: true,
  });
  await expect(page.getByText(/@privaterelay\.appleid\.com$/)).toBeVisible();
  await completeSocialSignup(page);
  await expect(page).toHaveURL(/\/inicio$/);
  const { body } = await classroomSession(page);
  expect(body.user.email).toMatch(/@privaterelay\.appleid\.com$/);
  expect(body.user.emailVerified).toBe(true);
});

test('Google com conta já confirmada: vincula e a senha continua valendo', async ({ page }) => {
  const student = await registerStudent('google-confirmada');
  const token = new URL(
    linkIn(await waitForMail(student.email, SUBJECTS.verify), '/confirmar'),
  ).searchParams.get('token');
  const verify = await isolatedRequest('classroom-api', {
    path: '/api/v1/auth/email/verify',
    body: { token },
  });
  expect(verify.status).toBe(204);

  await startSocial(page, 'google');
  await decideAtProvider(page, { sub: uniqueSubject('google-conf'), email: student.email });
  await expect(page).toHaveURL(/\/inicio$/);
  expect((await classroomSession(page)).body.user.email).toBe(student.email);
  const login = await isolatedLogin('classroom-api', student.email, student.password);
  expect(login.status).toBe(200);
});
