// Critério de saída da Fase 1: com termos publicados, o cadastro exige o aceite, e quem já tinha
// conta vê a tela de aceite (spec 030, RF-02 e RF-03; spec 007, "Termos no cadastro e aceite
// pendente"). Cada execução publica uma versão nova dos dois documentos, com novo aceite exigido:
// o efeito vale para a instalação inteira, por isso este arquivo roda depois dos demais
// (projeto `fase1-termos`).
import { expect, type Page, test } from '@playwright/test';
import {
  registerStudent,
  signInContext,
  testPassword,
  uniqueEmail,
} from '../../support/accounts.ts';
import { ADMIN_STATE } from '../../support/auth-state.ts';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import { isolatedRequest } from '../../support/isolated.ts';
import { pace } from '../../support/pacing.ts';
import {
  accountMenu,
  classroomSession,
  passwordField,
  TERMS_ACCEPT,
  tick,
} from '../../support/ui.ts';

const DOCUMENTS = [
  { tab: 'Termos de Uso', title: 'Termos de uso' },
  { tab: 'Política de Privacidade', title: 'Política de privacidade' },
] as const;

async function publishNewVersion(page: Page, tab: string, stamp: string): Promise<void> {
  await page.getByRole('tab', { name: tab }).click();
  await page.getByRole('button', { name: 'Novo rascunho' }).first().click();
  const dialog = page.getByRole('dialog', { name: `Novo rascunho: ${tab}` });
  const body = dialog.getByLabel('Texto (Markdown)');
  if ((await body.inputValue()).trim() === '') {
    await body.fill(`# ${tab}\n\nVersão de teste de ponta a ponta ${stamp}.\n`);
  }
  await tick(dialog, 'Exigir novo aceite de quem aceitou uma versão anterior');
  await dialog.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByRole('button', { name: /^Publicar o rascunho criado em / })
    .first()
    .click();
  const confirm = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: 'Publicar esta versão?' }));
  await confirm.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText(new RegExp(`^${tab}: versão \\d+ publicada\\.$`))).toBeVisible();
}

test.use({ viewport: { width: 1280, height: 900 } });

test('termos publicados: cadastro exige aceite e a conta antiga vê a tela de aceite', async ({
  browser,
  page,
}) => {
  const veteran = await registerStudent('termos-antigo');

  await test.step('o admin publica termos e privacidade, com novo aceite', async () => {
    const admin = await browser.newContext({
      storageState: ADMIN_STATE,
      viewport: { width: 1280, height: 900 },
    });
    const adminPage = await admin.newPage();
    await adminPage.goto(`${ADMIN_URL}/configuracoes/termos`);
    await expect(
      adminPage.getByRole('heading', { level: 1, name: 'Termos e privacidade' }),
    ).toBeVisible();
    const stamp = new Date().toISOString();
    for (const { tab } of DOCUMENTS) {
      await publishNewVersion(adminPage, tab, stamp);
    }
    await admin.close();
  });

  await test.step('o cadastro sem aceite é recusado', async () => {
    const response = await isolatedRequest('classroom-api', {
      path: '/api/v1/auth/register',
      body: {
        name: 'Sem Aceite',
        email: uniqueEmail('sem-aceite'),
        password: testPassword(),
        acceptedTerms: [],
      },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'terms_acceptance_required' });

    await page.goto(`${CLASSROOM_URL}/cadastro`);
    for (const { title } of DOCUMENTS) {
      await expect(
        page.getByRole('link', { name: new RegExp(`^${title} \\(versão \\d+\\)`) }),
      ).toBeVisible();
    }
    await page.getByLabel('Nome', { exact: true }).fill('Aluna Com Aceite');
    await page.getByLabel('E-mail', { exact: true }).fill(uniqueEmail('com-aceite'));
    await passwordField(page).fill(testPassword());
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.getByText('Para criar a conta, aceite os termos vigentes.')).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);
  });

  await test.step('com o aceite, o cadastro conclui', async () => {
    await tick(page, TERMS_ACCEPT);
    await pace('classroom', 2);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(accountMenu(page, 'Aluna Com Aceite')).toBeVisible();
    expect((await classroomSession(page)).body.termsPending).toEqual([]);
  });

  await test.step('quem tinha conta vê a tela de aceite e segue depois de aceitar', async () => {
    const context = await browser.newContext();
    await signInContext(context, 'classroom-api', veteran.email, veteran.password);
    const veteranPage = await context.newPage();
    await veteranPage.goto(`${CLASSROOM_URL}/inicio`);
    await expect(
      veteranPage.getByRole('heading', { name: 'Aceite os termos para continuar' }),
    ).toBeVisible();
    expect((await classroomSession(veteranPage)).body.termsPending).toHaveLength(2);
    await veteranPage.getByRole('button', { name: 'Aceitar e continuar' }).click();
    await expect(veteranPage.getByText('Marque a caixa para aceitar os documentos.')).toBeVisible();
    await tick(veteranPage, TERMS_ACCEPT);
    await veteranPage.getByRole('button', { name: 'Aceitar e continuar' }).click();
    await expect(
      veteranPage.getByRole('heading', { name: 'Aceite os termos para continuar' }),
    ).toBeHidden();
    await expect(accountMenu(veteranPage, veteran.name)).toBeVisible();
    expect((await classroomSession(veteranPage)).body.termsPending).toEqual([]);
    await context.close();
  });
});
