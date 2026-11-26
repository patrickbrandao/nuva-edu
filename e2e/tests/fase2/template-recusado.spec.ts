// Critério de saída da Fase 2, template do certificado recusado (PLAN; spec 015, "Higienização"):
// template com `<script>` ou com imagem externa é recusado na tela, com o problema e a linha, e
// nada é gravado.
import { expect, type Page, test } from '@playwright/test';
import { ADMIN_URL } from '../../support/env.ts';
import { adminCall, adminPage, runTag } from '../../support/fase2.ts';

const TAG = runTag();
const COURSE = `Template recusado e2e ${TAG}`;
const KEYS =
  '<p>{{aluno.nome}} concluiu {{curso.titulo}}. Código {{certificado.codigo}}, em {{certificado.url_validacao}}</p>';

const CASES = [
  {
    name: 'com <script>',
    html: ['<html>', '<body>', KEYS, '<script>alert("e2e")</script>', '</body>', '</html>'],
    line: 4,
    rule: 'Elemento não permitido',
  },
  {
    name: 'com imagem externa',
    html: [
      '<html>',
      '<body>',
      KEYS,
      '<p>Selo da escola</p>',
      '<img src="https://imagens.example.test/selo.png" alt="Selo">',
      '</body>',
      '</html>',
    ],
    line: 5,
    rule: 'Endereço não permitido',
  },
] as const;

async function expectNoTemplate(page: Page, courseId: string) {
  const template = await adminCall<{ source: string; html: string | null }>(
    page,
    'GET',
    `/api/v1/courses/${courseId}/certificate-template`,
  );
  expect(template).toMatchObject({ source: 'none', html: null });
}

test('template com script ou imagem externa é recusado com o problema e a linha', async ({
  browser,
}) => {
  const page = await adminPage(browser);
  const course = await adminCall<{ id: string }>(page, 'POST', '/api/v1/courses', {
    title: COURSE,
  });
  await page.goto(`${ADMIN_URL}/cursos/${course.id}?aba=template`);
  await expect(page.getByRole('heading', { level: 1, name: COURSE })).toBeVisible();
  const editor = page.getByLabel('HTML do template');

  for (const item of CASES) {
    await test.step(`template ${item.name}`, async () => {
      await editor.fill(item.html.join('\n'));
      await page.getByRole('button', { name: 'Salvar template' }).click();
      const problems = page.getByRole('alert').filter({ hasText: /O template tem \d+ problemas?/ });
      await expect(problems).toBeVisible();
      const problem = problems.getByRole('listitem').filter({ hasText: item.rule });
      await expect(problem).toHaveCount(1);
      await expect(
        problem.getByRole('button', { name: new RegExp(`^Linha ${item.line}, coluna \\d+$`) }),
      ).toBeVisible();
      await expect(page.getByText('Template do certificado salvo.')).toHaveCount(0);
      await expectNoTemplate(page, course.id);
    });
  }
  await page.context().close();
});
