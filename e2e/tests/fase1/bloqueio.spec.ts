// Critério de saída da Fase 1: 5 senhas erradas bloqueiam a conta (spec 007, RNF-02 e
// "Bloqueio e dispositivo novo"). As 5 tentativas erradas saem de um IP próprio
// (support/isolated.ts): pelo navegador, bloqueariam também o IP de onde vêm todos os testes. A
// sexta, com a senha certa, é feita na tela, de outro IP: a recusa é pelo e-mail.
import { expect, test } from '@playwright/test';
import { isolatedLogin, registerStudent } from '../../support/accounts.ts';
import { freshIp } from '../../support/isolated.ts';
import { SUBJECTS, waitForMail } from '../../support/mailpit.ts';
import { signInClassroom } from '../../support/ui.ts';

test('5 senhas erradas bloqueiam a conta; a sexta, certa, é recusada', async ({ page }) => {
  const student = await registerStudent('bloqueio');
  const ip = freshIp();

  await test.step('cinco tentativas com a senha errada', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await isolatedLogin(
        'classroom-api',
        student.email,
        `errada-${attempt}-x`,
        ip,
      );
      expect(response.status, `tentativa errada ${attempt}`).toBe(401);
      expect(response.body).toMatchObject({ code: 'invalid_credentials' });
    }
  });

  await test.step('a sexta, com a senha certa, é recusada na tela', async () => {
    const login = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/login');
    await signInClassroom(page, student.email, student.password);
    const response = await login;
    expect(response.status()).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
    await expect(page.getByText(/^Muitas tentativas erradas\. Por segurança/)).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
  });

  await test.step('o dono da conta recebe o aviso de bloqueio', async () => {
    const mail = await waitForMail(student.email, SUBJECTS.locked);
    expect(mail.subject).toMatch(SUBJECTS.locked);
  });
});
