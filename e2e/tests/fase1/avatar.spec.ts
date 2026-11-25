// Critério de saída da Fase 1: o aluno troca o avatar e ele aparece no painel (spec 007,
// "Avatar"; spec 029, envio e entrega).
import { expect, type Page, test } from '@playwright/test';
import { registerStudent, signInContext } from '../../support/accounts.ts';
import { ADMIN_STATE } from '../../support/auth-state.ts';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import { classroomSession } from '../../support/ui.ts';

/** PNG de 320 px desenhado pelo próprio navegador, com cor sorteada. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 70% 50%)`;
    ctx.fillRect(0, 0, 320, 320);
    ctx.fillStyle = '#fff';
    ctx.fillRect(80, 80, 160, 160);
    return canvas.toDataURL('image/png').split(',')[1] as string;
  });
  return Buffer.from(base64, 'base64');
}

/** O id da imagem no endereço de entrega (`/api/v1/images/<id>/<variante>.webp`). */
function imageIdOf(url: string): string {
  const match = /\/images\/([0-9a-f-]{36})\//.exec(url);
  if (!match?.[1]) throw new Error(`Endereço de avatar inesperado: ${url}`);
  return match[1];
}

test('o aluno troca o avatar no classroom e ele aparece no admin', async ({ page, browser }) => {
  const student = await registerStudent('avatar');
  await signInContext(page.context(), 'classroom-api', student.email, student.password);
  await page.goto(`${CLASSROOM_URL}/conta/perfil`);
  await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible();
  expect((await classroomSession(page)).body.user.avatarUrl).toBeNull();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Escolher foto' }).click();
  await (await chooser).setFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: await makePng(page),
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'Foto de perfil atualizada.' }),
  ).toBeVisible();

  const avatarUrl = (await classroomSession(page)).body.user.avatarUrl;
  expect(avatarUrl).toEqual(expect.any(String));
  const imageId = imageIdOf(avatarUrl as string);
  const preview = page.getByRole('img', { name: 'Sua foto de perfil' });
  await expect(preview).toBeVisible();
  const delivered = await page.request.get(new URL(avatarUrl as string, CLASSROOM_URL).href);
  expect(delivered.status()).toBe(200);
  expect(delivered.headers()['content-type']).toContain('image/webp');

  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const adminPage = await admin.newPage();
  await adminPage.goto(`${ADMIN_URL}/alunos?q=${encodeURIComponent(student.email)}`);
  const row = adminPage.getByRole('row').filter({ hasText: student.email });
  await expect(row).toHaveCount(1);
  // Com foto, o avatar do painel desenha a imagem dentro do círculo; sem foto, só a inicial.
  const photo = row
    .getByRole('img', { name: student.name })
    .getByRole('img', { name: student.name });
  await expect(photo).toBeVisible();
  const background = await photo.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(background).toContain(imageId);
  const src = /url\("?([^")]+)"?\)/.exec(background)?.[1] as string;
  const image = await adminPage.request.get(new URL(src, ADMIN_URL).href);
  expect(image.status(), 'a imagem do avatar é entregue pelo admin').toBe(200);
  await admin.close();
});
