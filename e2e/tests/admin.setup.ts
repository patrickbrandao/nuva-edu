// Abre uma sessão do admin inicial pela API (spec 007, "Login por senha") e a guarda para os
// testes do painel. Uma só por execução: o login conta no limite por IP da autenticação.
import { expect, test as setup } from '@playwright/test';
import { ADMIN_STATE } from '../support/auth-state.ts';
import { adminCredentials } from '../support/credentials.ts';
import { ADMIN_URL } from '../support/env.ts';

setup('sessão do admin inicial', async ({ request }) => {
  const { email, password } = adminCredentials();
  const response = await request.post(`${ADMIN_URL}/api/v1/auth/login`, {
    data: { email, password },
  });
  expect(response.status(), 'POST /api/v1/auth/login do admin inicial').toBe(200);
  expect((await response.json()).user.role).toBe('admin');
  await request.storageState({ path: ADMIN_STATE });
});
