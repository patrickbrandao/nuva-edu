// Critério de saída da Fase 2, curso aberto (PLAN; specs 009, 014, 015, 016): o instrutor monta e
// publica um curso aberto com módulos e aulas; o visitante o vê na vitrine; um aluno assiste
// (vídeo `file` servido pelo próprio teste), conclui pelo fim do vídeo e pelo botão e anota; sem
// template, vê "certificado ainda não liberado"; o instrutor confere o PDF de exemplo e salva o
// template; o aluno recebe o certificado por e-mail, com o texto do template no PDF, e o valida na
// página pública; um segundo aluno, que conclui com o template já salvo, recebe o dele direto.
import { expect, type Page, test } from '@playwright/test';
import type { Student } from '../../support/accounts.ts';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import {
  adminCall,
  adminPage,
  createStaff,
  learningPath,
  runTag,
  type Staff,
  SUBJECTS_FASE2,
  staffPage,
  studentPage,
  videoUrl,
  visitorPage,
} from '../../support/fase2.ts';
import { waitForMail } from '../../support/mailpit.ts';
import { compact, compactPdfText } from '../../support/pdf.ts';

const TAG = runTag();
const COURSE = `Fotografia aberta e2e ${TAG}`;
const PROGRAM = [
  { module: 'Primeiros passos', lessons: ['Luz natural', 'Composição'] },
  { module: 'Prática', lessons: ['Retrato ao ar livre'] },
] as const;
const LESSONS: readonly string[] = PROGRAM.flatMap((item) => item.lessons);
const FIRST_LESSON = PROGRAM[0].lessons[0];
const TEMPLATE_PHRASE = `Certificamos pela escola e2e ${TAG} que`;

/** Template próprio: frase reconhecível e as palavras-chave obrigatórias (spec 015). */
const TEMPLATE = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>body { font-family: Inter, sans-serif; padding: 40px; }</style></head>
<body>
  <h1>Certificado</h1>
  <p>${TEMPLATE_PHRASE}</p>
  <p><strong>{{aluno.nome}}</strong></p>
  <p>concluiu o curso {{curso.titulo}}, com {{curso.carga_horaria}} horas.</p>
  <p>Código {{certificado.codigo}} · {{certificado.url_validacao}}</p>
</body>
</html>`;

test.describe.configure({ mode: 'serial' });

let instructor: Staff;
let courseId = '';
let slug = '';

/** Abre o editor do curso numa aba. */
async function openEditor(page: Page, tab?: string) {
  await page.goto(`${ADMIN_URL}/cursos/${courseId}${tab ? `?aba=${tab}` : ''}`);
  await expect(page.getByRole('heading', { level: 1, name: COURSE })).toBeVisible();
}

/** Abre o módulo no acordeão do programa e devolve a região dele. */
async function expandModule(page: Page, module: string) {
  const toggle = page.getByRole('button', { name: new RegExp(`^${module}\\b`) });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const region = page.getByRole('region', { name: new RegExp(`^${module}\\b`) });
  await expect(region).toBeVisible();
  return region;
}

/** O programa da página pública, módulo a módulo, na ordem cadastrada. */
async function expectProgram(page: Page) {
  for (const { module, lessons } of PROGRAM) {
    const region = await expandModule(page, module);
    await expect(region.getByRole('listitem')).toHaveText(
      lessons.map((lesson) => new RegExp(`^${lesson}`)),
    );
  }
}

/** Abre a aula pelo programa do curso, na área de estudo. */
async function openLesson(page: Page, title: string) {
  await page.goto(learningPath(slug));
  const module = PROGRAM.find((item) => (item.lessons as readonly string[]).includes(title));
  const region = await expandModule(page, module?.module ?? '');
  await region.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

/** Conclui as aulas pelo botão do rodapé; na última, "Concluir curso". */
async function completeByButton(page: Page, titles: readonly string[]) {
  for (const title of titles) {
    await openLesson(page, title);
    const nav = page.getByRole('navigation', { name: 'Navegação da aula' });
    if (title === LESSONS.at(-1)) {
      // a última aula conclui e leva à página do curso (spec 014, "Página da aula")
      await nav.getByRole('button', { name: 'Concluir curso' }).click();
      await expect(page).toHaveURL(learningPath(slug));
    } else {
      await nav.getByRole('button', { name: 'Marcar como concluída' }).click();
      await expect(nav.getByRole('button', { name: 'Desmarcar conclusão' })).toBeVisible();
    }
  }
}

/** Baixa o PDF do certificado pelo botão do curso e devolve o texto compacto. */
async function downloadCertificate(page: Page): Promise<string> {
  await page.goto(learningPath(slug));
  const section = page.getByRole('region', { name: 'Certificados' });
  await expect(section.getByRole('heading', { name: 'Certificado emitido' })).toBeVisible({
    timeout: 60_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('button', { name: `Baixar certificado: ${COURSE}` }).click(),
  ]);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  return compactPdfText(await readFile(path));
}

/** Código do certificado mostrado na página do curso. */
async function certificateCode(page: Page): Promise<string> {
  const text =
    (await page
      .getByRole('region', { name: 'Certificados' })
      .getByText(/^Código: /)
      .textContent()) ?? '';
  const code = /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(text)?.[1];
  expect(code, `código no texto "${text}"`).toBeTruthy();
  return code as string;
}

test('o instrutor monta e publica um curso aberto; o visitante o vê na vitrine', async ({
  browser,
}) => {
  const admin = await adminPage(browser);
  // o fluxo "sem template" exige que a escola não tenha o padrão (spec 015, "Template efetivo")
  const schoolDefault = await adminCall<{ source: string }>(
    admin,
    'GET',
    '/api/v1/settings/certificate-template',
  );
  expect(
    schoolDefault.source,
    'A instalação tem template padrão do certificado: o curso novo não ficaria sem template. Exclua o padrão em Configurações para rodar este fluxo.',
  ).toBe('none');
  instructor = await createStaff(admin, 'instructor', `Instrutora E2E ${TAG}`);
  const page = await staffPage(browser, instructor);

  await test.step('o instrutor cria o curso; ele nasce rascunho e privado', async () => {
    await page.goto(`${ADMIN_URL}/cursos`);
    await page.getByRole('button', { name: 'Novo curso' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Novo curso' });
    await dialog.getByLabel('Título', { exact: true }).fill(COURSE);
    await dialog.getByLabel('Resumo', { exact: true }).fill('Luz, composição e retrato.');
    await dialog.getByRole('button', { name: 'Criar curso' }).click();
    await expect(page).toHaveURL(/\/cursos\/[0-9a-f-]{36}/);
    courseId = /\/cursos\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    await expect(page.getByRole('heading', { level: 1, name: COURSE })).toBeVisible();
    // instrutor não define o modo de acesso nem publica curso que não é aberto (spec 009)
    await expect(page.getByRole('button', { name: 'Publicar', exact: true })).toHaveCount(0);
    await expect(page.getByText('Privado', { exact: true }).first()).toBeVisible();
  });

  await test.step('o admin torna o curso aberto', async () => {
    await openEditor(admin);
    await admin.getByRole('button', { name: /^Modo de acesso:/ }).click();
    await admin.getByRole('option', { name: 'Aberto' }).click();
    await admin.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(admin.getByText('Dados do curso salvos.')).toBeVisible();
    slug = (await admin.getByLabel('Endereço (slug)').inputValue()).trim();
    expect(slug).not.toBe('');
  });

  await test.step('o instrutor cria os módulos e as aulas, com vídeo e duração', async () => {
    await openEditor(page, 'conteudo');
    for (const { module, lessons } of PROGRAM) {
      await page.getByRole('button', { name: 'Novo módulo' }).first().click();
      const moduleDialog = page.getByRole('dialog', { name: 'Novo módulo' });
      await moduleDialog.getByLabel('Nome do módulo').fill(module);
      await moduleDialog.getByRole('button', { name: 'Criar módulo' }).click();
      await expect(page.getByText(`Módulo “${module}” criado.`)).toBeVisible();
      for (const [index, lesson] of lessons.entries()) {
        await page.getByRole('button', { name: `Nova aula no módulo ${module}` }).click();
        const dialog = page.getByRole('dialog', { name: 'Nova aula' });
        await dialog.getByLabel('Título', { exact: true }).fill(lesson);
        await dialog
          .getByLabel('Endereço do vídeo')
          .fill(videoUrl(`${TAG}-${module.length}-${index}`));
        await dialog.getByLabel('Duração').fill('0:03');
        await dialog
          .getByLabel('Descrição', { exact: true })
          .fill(`Aula **${lesson}** do curso de fotografia.`);
        await dialog.getByRole('button', { name: 'Criar aula' }).click();
        await expect(page.getByText(`Aula “${lesson}” criada.`)).toBeVisible();
        await expect(dialog).toBeHidden();
      }
    }
  });

  await test.step('o instrutor publica as aulas e o curso', async () => {
    for (const lesson of LESSONS) {
      await page.getByRole('button', { name: `Publicar a aula ${lesson}` }).click();
      await expect(page.getByText(`Aula “${lesson}” publicada.`)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Publicar o curso?' });
    await confirm.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.getByText('Curso publicado.')).toBeVisible();
  });

  await test.step('o visitante, sem login, vê o curso na vitrine e o programa', async () => {
    const visitor = await visitorPage(browser);
    await visitor.goto(`${CLASSROOM_URL}/`);
    await visitor.getByRole('searchbox', { name: 'Buscar por título ou resumo' }).fill(COURSE);
    await visitor.getByRole('searchbox', { name: 'Buscar por título ou resumo' }).press('Enter');
    const products = visitor.getByRole('list', { name: 'Produtos da vitrine' });
    await expect(products.getByRole('link', { name: new RegExp(COURSE) })).toBeVisible();
    await products
      .getByRole('link', { name: new RegExp(COURSE) })
      .first()
      .click();
    await expect(visitor).toHaveURL(new RegExp(`/cursos/${slug}$`));
    await expect(visitor.getByRole('heading', { level: 1, name: COURSE })).toBeVisible();
    await expect(visitor).toHaveTitle(new RegExp(COURSE));
    await expectProgram(visitor);
    await expect(visitor.getByText('Gratuito', { exact: true }).first()).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Entrar para acessar' })).toBeVisible();
    await visitor.context().close();
  });

  await page.context().close();
  await admin.context().close();
});

let first: { student: Student; page: Page };

test('o aluno assiste, conclui pelo fim do vídeo e pelo botão, anota e vê o aviso de certificado não liberado', async ({
  browser,
}) => {
  test.skip(!slug, 'depende do curso publicado no teste anterior');
  first = await studentPage(browser, 'fase2-aluno');
  const { page } = first;

  await test.step('o vídeo da primeira aula toca até o fim e a aula é concluída sozinha', async () => {
    await openLesson(page, FIRST_LESSON);
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect(page.getByText('O vídeo terminou: aula marcada como concluída.')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Desfazer' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navegação da aula' });
    await expect(nav.getByRole('button', { name: 'Desmarcar conclusão' })).toBeVisible();
  });

  await test.step('o aluno anota na aba "Minhas notas" e a nota aparece em "Anotações"', async () => {
    await page.getByRole('tab', { name: 'Minhas notas' }).click();
    const notes = page.getByRole('region', { name: 'Minhas notas desta aula' });
    const body = notes.getByRole('textbox', { name: 'Nova anotação' });
    await body.fill(`Lembrar: luz lateral realça textura (${TAG}).`);
    await expect(notes.getByText('Salvo', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.goto(`${CLASSROOM_URL}/anotacoes`);
    const notebook = page.getByRole('list', { name: 'Suas anotações' });
    await expect(notebook).toContainText(`luz lateral realça textura (${TAG})`);
    await expect(notebook).toContainText(`${COURSE} · ${FIRST_LESSON}`);
  });

  await test.step('as outras aulas são concluídas pelo botão', async () => {
    await completeByButton(page, LESSONS.slice(1));
    await page.goto(learningPath(slug));
    await expect(
      page.getByText(`${LESSONS.length} de ${LESSONS.length} aulas concluídas`).first(),
    ).toBeVisible();
  });

  await test.step('sem template, o aluno vê "certificado ainda não liberado"', async () => {
    await expect(
      page
        .getByRole('region', { name: 'Certificados' })
        .getByText(/O certificado ainda não foi liberado pelo instrutor/),
    ).toBeVisible();
  });
});

test('o instrutor confere o PDF de exemplo e salva o template; quem já concluiu recebe o certificado e o valida', async ({
  browser,
}) => {
  test.skip(!first, 'depende do aluno que concluiu no teste anterior');
  const page = await staffPage(browser, instructor);

  await test.step('o PDF de exemplo sai com os dados fictícios e o texto do template', async () => {
    await openEditor(page, 'template');
    await expect(page.getByText('Sem template', { exact: true }).first()).toBeVisible();
    await page.getByLabel('HTML do template').fill(TEMPLATE);
    await page.getByRole('button', { name: 'Gerar PDF de exemplo' }).click();
    const link = page.getByRole('link', { name: /Abrir o PDF de exemplo/ });
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute('href');
    const response = await page.request.get(new URL(href ?? '', ADMIN_URL).toString());
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    const text = compactPdfText(await response.body());
    expect(text).toContain(compact(TEMPLATE_PHRASE));
    expect(text).toContain(compact('Maria Exemplo da Silva'));
    expect(text).toContain(compact(COURSE));
  });

  await test.step('salvar o template avisa que os certificados estão a caminho', async () => {
    await page.getByRole('button', { name: 'Salvar template' }).click();
    await expect(page.getByText('Template do certificado salvo.')).toBeVisible();
    await expect(
      page.getByText('Os alunos que já concluíram vão receber o certificado.'),
    ).toBeVisible();
  });
  await page.context().close();

  const { student, page: studentView } = first;
  await test.step('o aluno recebe o e-mail do certificado', async () => {
    const mail = await waitForMail(student.email, SUBJECTS_FASE2.certificateIssued(COURSE), {
      timeoutMs: 60_000,
    });
    expect(mail.text).toContain(`${CLASSROOM_URL}/certificados/`);
  });

  let code = '';
  await test.step('o PDF baixado traz o texto do template com os dados do aluno', async () => {
    const text = await downloadCertificate(studentView);
    code = await certificateCode(studentView);
    expect(text).toContain(compact(TEMPLATE_PHRASE));
    expect(text).toContain(compact(student.name));
    expect(text).toContain(compact(COURSE));
    expect(text).toContain(compact(code));
  });

  await test.step('a página pública valida o código, sem login', async () => {
    const visitor = await visitorPage(browser);
    await visitor.goto(`${CLASSROOM_URL}/certificados/${code}`);
    const result = visitor.getByRole('region', { name: 'Resultado da validação' });
    await expect(result.getByText('Certificado válido')).toBeVisible();
    await expect(result).toContainText(student.name);
    await expect(result).toContainText(COURSE);
    await expect(result).not.toContainText(student.email);
    await visitor.context().close();
  });
  await studentView.context().close();
});

test('com o template salvo, o aluno que conclui recebe o certificado e o valida pelo formulário', async ({
  browser,
}) => {
  test.skip(!slug, 'depende do curso publicado no primeiro teste');
  const { student, page } = await studentPage(browser, 'fase2-aluno2');
  await completeByButton(page, LESSONS);
  await waitForMail(student.email, SUBJECTS_FASE2.certificateIssued(COURSE), { timeoutMs: 60_000 });
  const text = await downloadCertificate(page);
  expect(text).toContain(compact(TEMPLATE_PHRASE));
  expect(text).toContain(compact(student.name));
  const code = await certificateCode(page);

  const visitor = await visitorPage(browser);
  await visitor.goto(`${CLASSROOM_URL}/certificados`);
  // aceito sem hífens e em minúsculas (spec 015, "Validação pública")
  await visitor.getByLabel('Código do certificado').fill(code.replace(/-/g, '').toLowerCase());
  await visitor.getByRole('button', { name: 'Validar' }).click();
  const result = visitor.getByRole('region', { name: 'Resultado da validação' });
  await expect(result.getByText('Certificado válido')).toBeVisible();
  await expect(result).toContainText(student.name);
  await visitor.context().close();
  await page.context().close();
});
