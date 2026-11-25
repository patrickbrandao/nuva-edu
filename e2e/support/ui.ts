// Passos de tela repetidos nos fluxos da Fase 1, só por papel e nome acessível.
import { expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL } from './env.ts';
import { pace } from './pacing.ts';

export type Provider = 'google' | 'facebook' | 'apple';
export const PROVIDER_NAMES: Record<Provider, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
};

/** Campo de senha pelo rótulo exato (o botão "Mostrar senha" fica de fora). */
export function passwordField(scope: Page | Locator, label = 'Senha'): Locator {
  return scope.getByLabel(label, { exact: true });
}

/**
 * Marca uma caixa como a pessoa faz: clicando no texto dela. A caixa desenhada por cima do
 * `input` (AdminCheckbox) intercepta o clique direto no `input`.
 */
export async function tick(scope: Page | Locator, label: string): Promise<void> {
  const box = scope.getByRole('checkbox', { name: label });
  if (!(await box.isChecked())) {
    await scope.getByText(label, { exact: true }).click();
  }
  await expect(box).toBeChecked();
}

export const TERMS_ACCEPT = 'Li e aceito os documentos acima';

/** Caixa de aceite dos termos vigentes, quando há versão publicada. */
export function termsCheckbox(scope: Page | Locator): Locator {
  return scope.getByRole('checkbox', { name: 'Li e aceito os documentos acima' });
}

/** Cadastro por e-mail e senha no classroom, aceitando os termos se houver. Termina logado. */
export async function signUpWithPassword(
  page: Page,
  account: { name: string; email: string; password: string },
): Promise<void> {
  await page.goto(`${CLASSROOM_URL}/cadastro`);
  await page.getByLabel('Nome', { exact: true }).fill(account.name);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await passwordField(page).fill(account.password);
  const submit = page.getByRole('button', { name: 'Criar conta', exact: true });
  await expect(submit).toBeEnabled();
  if (await termsCheckbox(page).isVisible()) {
    await tick(page, TERMS_ACCEPT);
  }
  await pace('classroom', 2); // cadastro + login
  await submit.click();
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(accountMenu(page, account.name)).toBeVisible();
}

/** Login por senha no classroom pela tela de entrada. */
export async function signInClassroom(page: Page, email: string, password: string) {
  if (!new URL(page.url()).pathname.startsWith('/entrar')) {
    await page.goto(`${CLASSROOM_URL}/entrar`);
  }
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await passwordField(page).fill(password);
  await pace('classroom');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Login por senha no painel pela tela de entrada. */
export async function signInAdmin(page: Page, email: string, password: string) {
  await page.goto(`${ADMIN_URL}/entrar`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await passwordField(page).fill(password);
  await pace('admin');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Menu da conta na barra do classroom. */
export function accountMenu(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `Menu da conta de ${name}` });
}

export async function signOutClassroom(page: Page, name: string): Promise<void> {
  await accountMenu(page, name).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(accountMenu(page, name)).toBeHidden();
}

/** Na tela do provedor simulado, preenche a identidade e decide. */
export async function decideAtProvider(
  page: Page,
  identity: {
    sub: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    hideEmail?: boolean;
    decision?: 'Autorizar' | 'Recusar';
  },
): Promise<void> {
  await expect(page).toHaveURL(/oauth-mock\./);
  await page.getByLabel('Identificador').fill(identity.sub);
  await page.getByLabel('E-mail', { exact: true }).fill(identity.email ?? '');
  await page.getByLabel('E-mail verificado').setChecked(identity.emailVerified ?? true);
  await page.getByLabel('Nome').fill(identity.name ?? '');
  const hide = page.getByLabel('Ocultar e-mail (retransmissão da Apple)');
  if ((await hide.count()) > 0) {
    await hide.setChecked(identity.hideEmail ?? false);
  }
  await page.getByRole('button', { name: identity.decision ?? 'Autorizar' }).click();
}

/** Na tela de entrada do classroom, começa o login social. */
export async function startSocial(page: Page, provider: Provider): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/entrar')) {
    await page.goto(`${CLASSROOM_URL}/entrar`);
  }
  await pace('classroom');
  await page.getByRole('button', { name: `Continuar com ${PROVIDER_NAMES[provider]}` }).click();
}

/** Conclui o cadastro pendente do login social (aceite dos termos, se houver). */
export async function completeSocialSignup(page: Page, email?: string): Promise<void> {
  await expect(page).toHaveURL(/\/cadastro\/social/);
  await expect(page.getByRole('heading', { name: 'Concluir cadastro', level: 1 })).toBeVisible();
  const submit = page.getByRole('button', { name: 'Criar conta', exact: true });
  await expect(submit).toBeVisible();
  if (email) {
    await page.getByLabel('E-mail', { exact: true }).fill(email);
  }
  if (await termsCheckbox(page).isVisible()) {
    await tick(page, TERMS_ACCEPT);
  }
  await pace('classroom');
  await submit.click();
}

/** Sessão atual do classroom, lida pela própria página (com o cookie dela). */
export async function classroomSession(page: Page): Promise<{
  status: number;
  body: {
    user: {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      avatarUrl: string | null;
    };
    csrfToken: string;
    termsPending: unknown[];
  };
}> {
  const response = await page.request.get(`${CLASSROOM_URL}/api/v1/session`);
  return { status: response.status(), body: response.ok() ? await response.json() : null };
}
