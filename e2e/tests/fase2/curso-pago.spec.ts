// Critério de saída da Fase 2, curso pago (PLAN; specs 009 e 010): na vitrine e na página do
// produto, o curso pago aparece com o preço e bloqueado, sem botão de compra, com o programa
// visível; a aula de amostra abre para o aluno sem acesso, e as demais não; a concessão manual
// pelo gerente libera o curso e avisa o aluno por e-mail.
import { expect, type Page, test } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import {
  adminCall,
  adminPage,
  createStaff,
  learningPath,
  runTag,
  SUBJECTS_FASE2,
  staffPage,
  studentPage,
  videoUrl,
  visitorPage,
} from '../../support/fase2.ts';
import { waitForMail } from '../../support/mailpit.ts';

const TAG = runTag();
const COURSE = `Aquarela paga e2e ${TAG}`;
const MODULE = 'Fundamentos da aquarela';
const SAMPLE = 'Materiais e pincéis';
const LOCKED = 'Camadas e transparência';
const PRICE_CENTS = 9990;
const PRICE = /R\$\s?99,90/;

interface Lesson {
  id: string;
  version: number;
}

/** Preparo pela API do admin: o curso pago, com uma aula de amostra e outra fechada, publicado. */
async function createPaidCourse(
  admin: Page,
): Promise<{ id: string; slug: string; lessons: Record<string, string> }> {
  const course = await adminCall<{ id: string; slug: string }>(admin, 'POST', '/api/v1/courses', {
    title: COURSE,
    summary: 'Técnicas de aquarela do básico ao avançado.',
    accessMode: 'paid',
    priceCents: PRICE_CENTS,
  });
  const module = await adminCall<{ id: string }>(
    admin,
    'POST',
    `/api/v1/courses/${course.id}/modules`,
    { title: MODULE },
  );
  const lessons: Record<string, string> = {};
  for (const [title, isSample] of [
    [SAMPLE, true],
    [LOCKED, false],
  ] as const) {
    const lesson = await adminCall<Lesson>(admin, 'POST', `/api/v1/modules/${module.id}/lessons`, {
      title,
      videoUrl: videoUrl(`${TAG}-${isSample ? 'amostra' : 'fechada'}`),
      durationSeconds: 3,
      isSample,
    });
    await adminCall(admin, 'PATCH', `/api/v1/lessons/${lesson.id}`, {
      status: 'published',
      version: lesson.version,
    });
    lessons[title] = lesson.id;
  }
  await adminCall(admin, 'POST', `/api/v1/courses/${course.id}/publish`, undefined, 200);
  return { id: course.id, slug: course.slug, lessons };
}

test('curso pago: bloqueado com programa e amostra; a concessão manual do gerente libera', async ({
  browser,
}) => {
  const admin = await adminPage(browser);
  const { slug, lessons } = await createPaidCourse(admin);
  const manager = await createStaff(admin, 'manager', `Gerente E2E ${TAG}`);
  await admin.context().close();

  await test.step('o visitante vê o curso na vitrine com o preço, bloqueado e sem compra', async () => {
    const visitor = await visitorPage(browser);
    await visitor.goto(`${CLASSROOM_URL}/`);
    const search = visitor.getByRole('searchbox', { name: 'Buscar por título ou resumo' });
    await search.fill(COURSE);
    await search.press('Enter');
    const products = visitor.getByRole('list', { name: 'Produtos da vitrine' });
    const card = products.getByRole('listitem').filter({ hasText: COURSE });
    await expect(card).toContainText(PRICE);
    await card
      .getByRole('link', { name: new RegExp(COURSE) })
      .first()
      .click();
    await expect(visitor).toHaveURL(new RegExp(`/cursos/${slug}$`));
    const access = visitor.getByRole('region', { name: 'Preço e acesso' });
    await expect(access).toContainText(PRICE);
    await expect(access).toContainText('Acesso liberado pela escola');
    // sem compra nem cesta na Fase 2 (spec 009, P6); o menu "Cesta" do site fica de fora
    const main = visitor.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: COURSE })).toBeVisible();
    await expect(main.getByRole('button', { name: /comprar|cesta/i })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /comprar|cesta/i })).toHaveCount(0);
    // o programa é público; a aula de amostra é marcada
    const toggle = visitor.getByRole('button', { name: new RegExp(`^${MODULE}`) });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const program = visitor.getByRole('region', { name: new RegExp(`^${MODULE}`) });
    await expect(program.getByRole('listitem')).toHaveText([
      new RegExp(`^${SAMPLE}.*Amostra grátis`),
      new RegExp(`^${LOCKED}`),
    ]);
    // nenhuma resposta pública traz o endereço do vídeo (spec 009)
    const publicCourse = await visitor.request.get(
      `${CLASSROOM_URL}/api/v1/catalog/course/${slug}`,
    );
    expect(publicCourse.status()).toBe(200);
    expect(await publicCourse.text()).not.toContain('videos.nuva-e2e.test');
    await visitor.context().close();
  });

  const { student, page } = await studentPage(browser, 'fase2-pago');

  await test.step('o aluno sem acesso vê o curso bloqueado e assiste à aula de amostra', async () => {
    await page.goto(learningPath(slug));
    await expect(page.getByText('Curso bloqueado').first()).toBeVisible();
    await expect(
      page.getByText('As aulas marcadas como amostra grátis continuam liberadas.'),
    ).toBeVisible();

    await page.goto(`${learningPath(slug)}/aulas/${lessons[SAMPLE]}`);
    await expect(page.getByRole('heading', { level: 1, name: SAMPLE })).toBeVisible();
    await expect(page.getByText('Aula liberada', { exact: true })).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
  });

  await test.step('a aula fechada mostra o motivo e a API recusa o conteúdo', async () => {
    await expectLocked(page, slug, lessons[LOCKED] ?? '');
    const lesson = await page.request.get(`${CLASSROOM_URL}/api/v1/lessons/${lessons[LOCKED]}`);
    expect(lesson.status()).toBe(403);
    expect(await lesson.text()).not.toContain('videos.nuva-e2e.test');
  });

  await test.step('o gerente concede o curso pela ficha do aluno', async () => {
    const panel = await staffPage(browser, manager);
    await panel.goto(`${ADMIN_URL}/alunos?q=${encodeURIComponent(student.email)}`);
    await panel.getByRole('link', { name: student.name, exact: true }).click();
    await expect(panel.getByRole('heading', { level: 1, name: student.name })).toBeVisible();
    await panel.getByRole('button', { name: 'Conceder acesso' }).click();
    const dialog = panel.getByRole('dialog', { name: `Conceder acesso a ${student.name}` });
    await expect(dialog.getByRole('button', { name: /^Tipo de produto: Curso/ })).toBeVisible();
    await dialog
      .getByRole('searchbox', { name: 'Buscar produto por título ou resumo' })
      .fill(COURSE);
    await dialog.getByRole('button', { name: 'Buscar', exact: true }).click();
    await dialog.getByRole('button', { name: `Escolher ${COURSE}` }).click();
    await dialog.getByLabel('Motivo').fill('Bolsa de estudos (e2e).');
    await dialog.getByRole('button', { name: 'Conceder', exact: true }).click();
    await expect(panel.getByText(`Acesso a “${COURSE}” concedido.`)).toBeVisible();
    await panel.context().close();
  });

  await test.step('o aluno recebe o e-mail e passa a assistir à aula fechada', async () => {
    await waitForMail(student.email, SUBJECTS_FASE2.accessGranted(COURSE), { timeoutMs: 60_000 });
    await page.goto(`${learningPath(slug)}/aulas/${lessons[LOCKED]}`);
    await expect(page.getByRole('heading', { level: 1, name: LOCKED })).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
    await expect(page.getByText('Aula bloqueada')).toHaveCount(0);
    await page.goto(learningPath(slug));
    await expect(page.getByText('Curso bloqueado')).toHaveCount(0);
  });
  await page.context().close();
});

/** A aula fechada: no lugar do player, o motivo (spec 010). */
async function expectLocked(page: Page, slug: string, lessonId: string) {
  await page.goto(`${learningPath(slug)}/aulas/${lessonId}`);
  await expect(page.getByText('Aula bloqueada').first()).toBeVisible();
  await expect(page.getByText('Você ainda não tem acesso a este curso.')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
}
