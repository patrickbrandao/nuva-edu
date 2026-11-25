// Contas de teste: e-mails únicos por execução (o banco não é zerado entre execuções) e o preparo
// das contas que não são o comportamento em teste, pela rede interna (support/isolated.ts).
import { randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL } from './env.ts';
import { type IsolatedResponse, isolatedRequest, type Service } from './isolated.ts';

const RUN = Date.now().toString(36);

/** E-mail que nenhuma outra execução nem outro teste usa. */
export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${RUN}-${randomBytes(3).toString('hex')}@example.test`;
}

/** Senha de teste nova (8 a 128 caracteres), distinta o bastante para a varredura. */
export function testPassword(): string {
  return `Nuva-e2e-${randomBytes(9).toString('base64url')}`;
}

/** Identificador de usuário no provedor simulado. */
export function uniqueSubject(tag: string): string {
  return `e2e-${tag}-${RUN}-${randomBytes(4).toString('hex')}`;
}

/** `id` das versões vigentes de termos e privacidade (vazio quando não há versão publicada). */
export async function currentTermsIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const document of ['terms', 'privacy']) {
    const response = await isolatedRequest('classroom-api', { path: `/api/v1/legal/${document}` });
    if (response.status === 200) {
      ids.push((response.body as { id: string }).id);
    } else if (response.status !== 404) {
      throw new Error(`GET /api/v1/legal/${document} respondeu ${response.status}`);
    }
  }
  return ids;
}

export interface Student {
  name: string;
  email: string;
  password: string;
}

/** Cria a conta de aluno pelo cadastro, aceitando os termos vigentes. Não confirma o e-mail. */
export async function registerStudent(tag: string): Promise<Student> {
  const student = {
    name: `Aluno ${tag} ${randomBytes(2).toString('hex')}`,
    email: uniqueEmail(tag),
    password: testPassword(),
  };
  const response = await isolatedRequest('classroom-api', {
    path: '/api/v1/auth/register',
    body: { ...student, acceptedTerms: await currentTermsIds() },
  });
  if (response.status !== 204) {
    throw new Error(`Cadastro de ${student.email} respondeu ${response.status}`);
  }
  return student;
}

/** Login pela rede interna; devolve a resposta inteira (status, corpo, cookies). */
export function isolatedLogin(
  service: Service,
  email: string,
  password: string,
  ip?: string,
): Promise<IsolatedResponse> {
  return isolatedRequest(service, {
    path: '/api/v1/auth/login',
    body: { email, password },
    ...(ip ? { ip } : {}),
  });
}

const SESSION_COOKIE = {
  'classroom-api': 'nuva_classroom_session',
  'admin-api': 'nuva_admin_session',
};
const SITE_URL = { 'classroom-api': CLASSROOM_URL, 'admin-api': ADMIN_URL };

/** Entra com e-mail e senha e põe o cookie da sessão no contexto do navegador. */
export async function signInContext(
  context: BrowserContext,
  service: Service,
  email: string,
  password: string,
): Promise<void> {
  const response = await isolatedLogin(service, email, password);
  const name = SESSION_COOKIE[service];
  const value = response.cookies[name];
  if (response.status !== 200 || !value) {
    throw new Error(`Login de ${email} na ${service} respondeu ${response.status}`);
  }
  await context.addCookies([
    { name, value, url: SITE_URL[service], httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}
