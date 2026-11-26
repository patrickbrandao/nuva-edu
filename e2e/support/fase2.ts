// Apoio aos fluxos do critério de saída da Fase 2: sessões da equipe e de alunos, o vídeo servido
// pelo próprio teste (sem provedor externo) e o preparo pela API do que não é o comportamento em
// teste.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type APIResponse,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from '@playwright/test';
import {
  registerStudent,
  type Student,
  signInContext,
  testPassword,
  uniqueEmail,
} from './accounts.ts';
import { ADMIN_STATE } from './auth-state.ts';
import { ADMIN_URL, CLASSROOM_URL } from './env.ts';

/** Sufixo curto e único por execução, para títulos que a vitrine e as buscas mostram. */
export function runTag(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Host fictício dos vídeos. O admin aceita qualquer `https` terminando em `.webm` (provedor
 * `file`, spec 009) e nunca busca a URL; quem a busca é o navegador do aluno, e o teste responde
 * no lugar da rede com `serveVideo`.
 */
export const VIDEO_HOST = 'https://videos.nuva-e2e.test';

/** Vídeo WebM de 3 s (320×180, VP9), gerado para o e2e: não depende de nenhum provedor. */
const VIDEO = readFileSync(resolve(import.meta.dirname, '..', 'fixtures', 'aula.webm'));
export const VIDEO_SECONDS = 3;

export function videoUrl(name: string): string {
  return `${VIDEO_HOST}/${name}.webm`;
}

/** O mesmo vídeo com a extensão `.mp4`: o admin classifica pelo sufixo, sem buscar a URL. */
export function mp4Url(name: string): string {
  return `${VIDEO_HOST}/${name}.mp4`;
}

/** Responde aos pedidos de vídeo do contexto com o arquivo local; nada sai para a rede. */
export async function serveVideo(context: BrowserContext): Promise<void> {
  await context.route(`${VIDEO_HOST}/**`, async (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    // O mesmo arquivo serve `.webm` e `.mp4` (só a extensão muda: o admin classifica sem buscar).
    const contentType = route.request().url().endsWith('.mp4') ? 'video/mp4' : 'video/webm';
    if (!range) {
      await route.fulfill({
        status: 200,
        contentType,
        headers: { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' },
        body: VIDEO,
      });
      return;
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), VIDEO.length - 1) : VIDEO.length - 1;
    await route.fulfill({
      status: 206,
      contentType,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${VIDEO.length}`,
        'access-control-allow-origin': '*',
      },
      body: VIDEO.subarray(start, end + 1),
    });
  });
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Chamada à API do site aberto na página, com o cookie dela e o token CSRF da sessão. */
export async function siteApi(
  page: Page,
  base: string,
  method: Method,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  const session = await page.request.get(`${base}/api/v1/session`);
  expect(session.status(), `GET ${base}/api/v1/session`).toBe(200);
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  return page.request.fetch(`${base}${path}`, {
    method,
    headers: { 'x-csrf-token': csrfToken },
    ...(data === undefined ? {} : { data }),
  });
}

/** `siteApi` no admin, esperando o status dado e devolvendo o corpo. */
export async function adminCall<T = Record<string, unknown>>(
  page: Page,
  method: Method,
  path: string,
  data?: unknown,
  status = method === 'POST' ? 201 : 200,
): Promise<T> {
  const response = await siteApi(page, ADMIN_URL, method, path, data);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Página nova com viewport de mesa. */
async function newPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  return page;
}

/** Página do painel com a sessão do admin inicial (projeto `setup`). */
export async function adminPage(browser: Browser): Promise<Page> {
  return newPage(await browser.newContext({ storageState: ADMIN_STATE }));
}

export interface Staff {
  id: string;
  name: string;
  email: string;
  password: string;
}

/** Conta da equipe criada pelo admin pela API (preparo; a criação pela tela é da Fase 1). */
export async function createStaff(
  admin: Page,
  role: 'instructor' | 'manager',
  name: string,
): Promise<Staff> {
  const staff = { name, email: uniqueEmail(role), password: testPassword() };
  const created = await adminCall<{ id: string }>(admin, 'POST', '/api/v1/users', {
    ...staff,
    role,
  });
  return { id: created.id, ...staff };
}

/** Página do painel com a sessão de um membro da equipe aberta pela rede interna. */
export async function staffPage(browser: Browser, staff: Staff): Promise<Page> {
  const context = await browser.newContext();
  await signInContext(context, 'admin-api', staff.email, staff.password);
  return newPage(context);
}

/** Aluno novo, com a sessão do classroom aberta e o vídeo servido localmente. */
export async function studentPage(
  browser: Browser,
  tag: string,
): Promise<{ student: Student; page: Page }> {
  const student = await registerStudent(tag);
  const context = await browser.newContext();
  await signInContext(context, 'classroom-api', student.email, student.password);
  await serveVideo(context);
  return { student, page: await newPage(context) };
}

/** Visitante sem sessão. */
export async function visitorPage(browser: Browser): Promise<Page> {
  return newPage(await browser.newContext());
}

/** Endereço do curso no site do aluno (área de estudo). */
export function learningPath(slug: string): string {
  return `${CLASSROOM_URL}/meus-cursos/${slug}`;
}

export const SUBJECTS_FASE2 = {
  accessGranted: (title: string) => new RegExp(`^Acesso liberado em .+: ${escapeRegExp(title)}$`),
  certificateIssued: (title: string) =>
    new RegExp(`^Certificado disponível em .+: ${escapeRegExp(title)}$`),
};

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
