// Critério de saída da Fase 1: a varredura não encontra a senha de teste fora da rota de exibição
// (spec 007, "Exibição da senha"; spec 033, logs sem segredo). A conta nasce pela tela com uma senha
// nova; o admin a vê pela tela. Toda resposta recebida pelos dois navegadores é guardada, e a
// senha só pode aparecer na de `POST /api/v1/users/{id}/password/reveal`. Depois, os logs dos
// contêineres desde o início do teste e os e-mails da conta também não podem trazê-la. As
// mensagens de falha citam só onde a senha apareceu, nunca o valor.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, type Page, test } from '@playwright/test';
import { testPassword, uniqueEmail } from '../../support/accounts.ts';
import { ADMIN_STATE } from '../../support/auth-state.ts';
import { adminCredentials } from '../../support/credentials.ts';
import { ADMIN_URL, ROOT_DIR, USES_LOCAL_COMPOSE } from '../../support/env.ts';
import { mailTexts } from '../../support/mailpit.ts';
import { passwordField, signUpWithPassword } from '../../support/ui.ts';

const REVEAL = /^\/api\/v1\/users\/[^/]+\/password\/reveal$/;

interface Recorded {
  method: string;
  path: string;
  body: string;
}

/** Registra respostas concluídas e os eventos já entregues pelo EventSource do Chromium. */
async function record(page: Page): Promise<{ done: () => Promise<Recorded[]> }> {
  const pending: Promise<Recorded | null>[] = [];
  const events: Recorded[] = [];
  const requests = new Map<string, Pick<Recorded, 'method' | 'path'>>();
  const devtools = await page.context().newCDPSession(page);
  devtools.on('Network.requestWillBeSent', ({ requestId, request }) => {
    requests.set(requestId, {
      method: request.method,
      path: new URL(request.url).pathname,
    });
  });
  devtools.on('Network.eventSourceMessageReceived', ({ requestId, data, eventId, eventName }) => {
    const request = requests.get(requestId) ?? { method: 'GET', path: '(EventSource)' };
    events.push({ ...request, body: [eventId, eventName, data].join('\n') });
  });
  await devtools.send('Network.enable');

  page.on('response', (response) => {
    // A conexão SSE fica aberta enquanto a aba está ativa. Os eventos chegam pelo CDP.
    if (response.request().resourceType() === 'eventsource') return;
    pending.push(
      response
        .body()
        .then((body) => ({
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          body: body.toString('utf8'),
        }))
        .catch(() => null), // redirecionamento ou corpo já descartado
    );
  });
  return {
    done: async () => [...(await Promise.all(pending)).filter((item) => item !== null), ...events],
  };
}

test('a senha de teste só aparece na resposta da exibição', async ({ page, browser }) => {
  const started = new Date();
  const account = {
    name: 'Aluno Varredura',
    email: uniqueEmail('varredura'),
    password: testPassword(),
  };
  const classroomResponses = await record(page);

  await test.step('o aluno se cadastra pela tela', async () => {
    await signUpWithPassword(page, account);
  });

  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const adminPage = await admin.newPage();
  const adminResponses = await record(adminPage);
  await test.step('o admin vê a senha na ficha', async () => {
    await adminPage.goto(`${ADMIN_URL}/alunos?q=${encodeURIComponent(account.email)}`);
    await adminPage.getByRole('link', { name: account.name, exact: true }).click();
    await adminPage.getByRole('button', { name: 'Mostrar senha' }).click();
    const dialog = adminPage.getByRole('dialog', { name: `Senha de ${account.name}` });
    await passwordField(dialog, 'Sua senha de administrador').fill(adminCredentials().password);
    await dialog.getByRole('button', { name: 'Ver a senha' }).click();
    await expect(dialog.getByRole('button', { name: 'Ocultar e fechar' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Ocultar e fechar' }).click();
  });
  await admin.close();

  await test.step('nas respostas, só a da exibição traz a senha', async () => {
    const all = [...(await classroomResponses.done()), ...(await adminResponses.done())];
    const withPassword = all.filter((item) => item.body.includes(account.password));
    const outside = withPassword.filter(
      (item) => !(item.method === 'POST' && REVEAL.test(item.path)),
    );
    expect(
      outside.map((item) => `${item.method} ${item.path}`),
      'respostas, fora da exibição, que trazem a senha de teste',
    ).toEqual([]);
    expect(withPassword.length, 'a resposta da exibição traz a senha (a varredura enxerga)').toBe(
      1,
    );
  });

  await test.step('os e-mails da conta não trazem a senha', async () => {
    const texts = await mailTexts(account.email);
    expect(texts.length).toBeGreaterThan(0);
    expect(
      texts.filter((mail) => mail.text.includes(account.password)).map((mail) => mail.subject),
      'e-mails que trazem a senha de teste',
    ).toEqual([]);
  });

  await test.step('os logs dos contêineres não trazem a senha do aluno nem a do admin', async () => {
    test.skip(!USES_LOCAL_COMPOSE, 'NUVA_E2E_COMPOSE=0: sem acesso aos logs dos contêineres');
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ['scripts/dev.mjs', 'compose', 'logs', '--no-color', '--since', started.toISOString()],
      { cwd: ROOT_DIR, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
    );
    const logs = `${stdout}\n${stderr}`;
    expect(logs.length, 'os logs foram lidos').toBeGreaterThan(0);
    const services = (secret: string) => [
      ...new Set(
        logs
          .split('\n')
          .filter((line) => line.includes(secret))
          .map((line) => line.split('|')[0]?.trim() ?? '?'),
      ),
    ];
    expect(services(account.password), 'serviços cujo log traz a senha do aluno').toEqual([]);
    expect(
      services(adminCredentials().password),
      'serviços cujo log traz a senha do admin',
    ).toEqual([]);
  });
});
