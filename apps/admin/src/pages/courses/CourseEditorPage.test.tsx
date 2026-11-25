import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { problem } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  COURSE_ID,
  courseDetail,
  courseModule,
  fakeCatalog,
  lessonSummary,
  stubSortableLayout,
} from '../../test/courses';
import { findMenu, renderApp } from '../../test/render';

const PATH = `/cursos/${COURSE_ID}`;
const CONTENT = `${PATH}?aba=conteudo`;
const M1 = '0193a5b2-0000-7000-8000-0000000000e1';
const M2 = '0193a5b2-0000-7000-8000-0000000000e2';
const L1 = '0193a5b2-0000-7000-8000-0000000000f1';
const L2 = '0193a5b2-0000-7000-8000-0000000000f2';
const L3 = '0193a5b2-0000-7000-8000-0000000000f3';

/** Curso com 2 módulos e 3 aulas: duas no primeiro, uma no segundo. */
function filled(overrides: Parameters<typeof courseDetail>[0] = {}) {
  return courseDetail({
    moduleCount: 2,
    modules: [
      courseModule({
        id: M1,
        title: 'Fundamentos',
        lessons: [
          lessonSummary({ id: L1, moduleId: M1, title: 'Variáveis', durationSeconds: 754 }),
          lessonSummary({ id: L2, moduleId: M1, title: 'Funções', position: 1, isSample: true }),
        ],
      }),
      courseModule({
        id: M2,
        title: 'Projetos',
        position: 1,
        lessons: [lessonSummary({ id: L3, moduleId: M2, title: 'Calculadora' })],
      }),
    ],
    ...overrides,
  });
}

const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubSortableLayout();
  // o jsdom não cria endereço `blob:` para a prévia da capa
  URL.createObjectURL = () => 'blob:previa';
  URL.revokeObjectURL = () => {};
});
afterEach(() => restoreLayout());

describe('editor de curso: módulos e aulas', () => {
  it('cria 2 módulos e 3 aulas e reordena, só com o teclado e sem violações do axe', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [courseDetail()] });
    renderApp(CONTENT, catalog.respond);
    await heading('Curso de Python');
    expect(await screen.findByText('Nenhum módulo ainda')).toBeTruthy();

    const addModule = async (name: string) => {
      (screen.getAllByRole('button', { name: 'Novo módulo' })[0] as HTMLElement).focus();
      await user.keyboard('{Enter}');
      const box = await screen.findByRole('dialog', { name: 'Novo módulo' });
      expect(document.activeElement).toBe(within(box).getByLabelText('Nome do módulo'));
      await user.keyboard(`${name}{Enter}`);
      await screen.findByRole('heading', { level: 3, name });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };
    const addLesson = async (module: string, title: string) => {
      button(`Nova aula no módulo ${module}`).focus();
      await user.keyboard('{Enter}');
      const box = await screen.findByRole('dialog', { name: 'Nova aula' });
      expect(document.activeElement).toBe(within(box).getByLabelText('Título'));
      await user.keyboard(title);
      // o botão de enviar fica no rodapé do diálogo, ligado ao formulário
      within(box).getByRole('button', { name: 'Criar aula' }).focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('button', { name: title });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };

    await addModule('Fundamentos');
    await addModule('Projetos');
    await addLesson('Fundamentos', 'Variáveis');
    await addLesson('Fundamentos', 'Funções');
    await addLesson('Projetos', 'Calculadora');

    const stored = () => catalog.course(COURSE_ID);
    expect(stored()?.modules.map((item) => item.title)).toEqual(['Fundamentos', 'Projetos']);
    expect(stored()?.modules.map((item) => item.lessons.map((lesson) => lesson.title))).toEqual([
      ['Variáveis', 'Funções'],
      ['Calculadora'],
    ]);
    expect(catalog.bodies(`POST /api/v1/courses/${COURSE_ID}/modules`)).toEqual([
      { title: 'Fundamentos' },
      { title: 'Projetos' },
    ]);
    const [fundamentos, projetos] = stored()?.modules ?? [];
    expect(catalog.bodies(`POST /api/v1/modules/${fundamentos?.id}/lessons`)[0]).toEqual({
      title: 'Variáveis',
      description: null,
      videoUrl: null,
      durationSeconds: null,
      isSample: false,
    });
    await expectNoAxeViolations();

    // módulos: "Fundamentos" desce para a segunda posição (espaço, seta, espaço)
    const moduleHandle = button('Mover Fundamentos');
    expect(moduleHandle.getAttribute('aria-roledescription')).toBe('item reordenável');
    moduleHandle.focus();
    await user.keyboard('[Space]');
    await tick();
    await user.keyboard('[ArrowDown]');
    await tick();
    await user.keyboard('[Space]');
    await tick();
    await waitFor(() =>
      expect(catalog.bodies(`PUT /api/v1/courses/${COURSE_ID}/modules/order`)).toEqual([
        { moduleIds: [projetos?.id, fundamentos?.id] },
      ]),
    );
    const modules = within(screen.getByRole('list', { name: 'Módulos do curso' }));
    expect(modules.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      'Projetos',
      'Fundamentos',
    ]);
    // cada lista tem a própria região de anúncios
    const announced = [...document.querySelectorAll('[id^="DndLiveRegion"]')].map(
      (node) => node.textContent,
    );
    expect(announced).toContain('Fundamentos solto na posição 2 de 2.');

    // aulas: "Variáveis" desce para depois de "Funções"
    await waitFor(() =>
      expect(button('Mover Variáveis').getAttribute('aria-disabled')).toBe('false'),
    );
    button('Mover Variáveis').focus();
    await user.keyboard('[Space]');
    await tick();
    await user.keyboard('[ArrowDown]');
    await tick();
    await user.keyboard('[Space]');
    await tick();
    await waitFor(() =>
      expect(catalog.bodies(`PUT /api/v1/modules/${fundamentos?.id}/lessons/order`)).toEqual([
        { lessonIds: fundamentos?.lessons.map((lesson) => lesson.id) },
      ]),
    );
    expect(stored()?.modules.map((item) => item.lessons.map((lesson) => lesson.title))).toEqual([
      ['Calculadora'],
      ['Funções', 'Variáveis'],
    ]);
    const lessons = within(screen.getByRole('list', { name: 'Aulas do módulo Fundamentos' }));
    expect(
      lessons.getAllByRole('button', { name: /^(Variáveis|Funções)$/ }).map((n) => n.textContent),
    ).toEqual(['Funções', 'Variáveis']);
    await expectNoAxeViolations();
  });

  it('ordem recusada pela API avisa e volta ao que está gravado', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [filled()],
      overrides: {
        [`PUT /api/v1/courses/${COURSE_ID}/modules/order`]: () => problem(422, 'order_mismatch'),
      },
    });
    renderApp(CONTENT, catalog.respond);
    (await screen.findByRole('button', { name: 'Mover Fundamentos' })).focus();
    await user.keyboard('[Space]');
    await tick();
    await user.keyboard('[ArrowDown]');
    await tick();
    await user.keyboard('[Space]');
    await tick();
    expect(await screen.findByText('Não foi possível gravar a ordem dos módulos')).toBeTruthy();
    expect(screen.getByText(/A ordem enviada não confere/)).toBeTruthy();
    await waitFor(() => {
      const modules = within(screen.getByRole('list', { name: 'Módulos do curso' }));
      expect(modules.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual(
        ['Fundamentos', 'Projetos'],
      );
    });
  });

  it('mostra situação, amostra e duração de cada aula; renomeia e exclui módulo vazio', async () => {
    const user = userEvent.setup();
    const course = filled();
    course.modules.push(courseModule({ id: 'vazio', title: 'Extras', position: 2 }));
    const catalog = fakeCatalog({ courses: [course] });
    renderApp(CONTENT, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Aulas do módulo Fundamentos' });
    expect(within(list).getAllByText('Rascunho')).toHaveLength(2);
    expect(within(list).getByText('Amostra grátis')).toBeTruthy();
    expect(within(list).getByText('12:34')).toBeTruthy();
    expect(screen.getByText('Nenhuma aula neste módulo.')).toBeTruthy();
    // módulo com aulas não oferece excluir
    expect(screen.queryByRole('button', { name: 'Excluir o módulo Fundamentos' })).toBeNull();

    await user.click(button('Renomear o módulo Extras'));
    const box = await screen.findByRole('dialog', { name: 'Renomear o módulo' });
    const name = within(box).getByLabelText('Nome do módulo');
    await user.clear(name);
    await user.type(name, 'Bônus{Enter}');
    await screen.findByRole('heading', { level: 3, name: 'Bônus' });
    expect(catalog.bodies('PATCH /api/v1/modules/vazio')).toEqual([{ title: 'Bônus' }]);

    await user.click(button('Excluir o módulo Bônus'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Excluir o módulo?' });
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: 'Bônus' })).toBeNull(),
    );
    expect(catalog.writes()).toContain('DELETE /api/v1/modules/vazio');
  });

  it('limite do catálogo recusado pela API aparece no diálogo, com o teto', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [filled()],
      overrides: {
        [`POST /api/v1/courses/${COURSE_ID}/modules`]: () =>
          problem(422, 'catalog_limit_exceeded', { limit: 'course_modules', max: 100 }),
      },
    });
    renderApp(CONTENT, catalog.respond);
    await user.click(await screen.findByRole('button', { name: 'Novo módulo' }));
    const box = await screen.findByRole('dialog', { name: 'Novo módulo' });
    await user.type(within(box).getByLabelText('Nome do módulo'), 'Mais um{Enter}');
    expect(await within(box).findByText('O curso chegou ao limite: no máximo 100.')).toBeTruthy();
  });

  it('publica, despublica e exclui a aula', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(CONTENT, catalog.respond);
    await user.click(await screen.findByRole('button', { name: 'Publicar a aula Variáveis' }));
    await user.click(await screen.findByRole('button', { name: 'Despublicar a aula Variáveis' }));
    await screen.findByRole('button', { name: 'Publicar a aula Variáveis' });
    expect(catalog.bodies(`PATCH /api/v1/lessons/${L1}`)).toEqual([
      { status: 'published' },
      { status: 'draft' },
    ]);

    await user.click(button('Excluir a aula Calculadora'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Excluir a aula?' });
    expect(
      within(confirm).getByText(/O progresso e as notas dos alunos ficam guardados/),
    ).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Calculadora' })).toBeNull());
    expect(catalog.writes()).toContain(`DELETE /api/v1/lessons/${L3}`);
  });
});

describe('editor de curso: aula', () => {
  it('abre a aula pelo endereço, edita o vídeo, a duração e os links de apoio', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    const { router } = renderApp(`${CONTENT}&aula=${L1}`, catalog.respond);
    const title = (await screen.findByLabelText('Título')) as HTMLInputElement;
    const box = screen.getByRole('dialog', { name: 'Editar a aula' });
    expect(title.value).toBe('Variáveis');
    expect((within(box).getByLabelText('Duração') as HTMLInputElement).value).toBe('12:34');

    await user.type(within(box).getByLabelText('Endereço do vídeo'), 'https://youtu.be/abc123');
    await user.clear(within(box).getByLabelText('Duração'));
    await user.type(within(box).getByLabelText('Duração'), '1:05:30');
    await user.click(within(box).getByRole('switch', { name: 'Amostra grátis' }));
    await user.click(within(box).getByRole('button', { name: 'Adicionar link' }));
    await user.type(within(box).getByLabelText('Rótulo'), 'Slides');
    await user.type(within(box).getByLabelText('Endereço'), 'https://exemplo.com/slides.pdf');
    await user.click(within(box).getByRole('button', { name: 'Adicionar link' }));
    await user.type(within(box).getAllByLabelText('Rótulo')[1] as HTMLElement, 'Documentação');
    await user.type(
      within(box).getAllByLabelText('Endereço')[1] as HTMLElement,
      'https://docs.python.org',
    );
    await user.click(within(box).getByRole('button', { name: 'Tipo de Documentação: Arquivo' }));
    await user.click(within(box).getByRole('option', { name: 'Página' }));
    await expectNoAxeViolations();

    await user.click(within(box).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(catalog.bodies(`PATCH /api/v1/lessons/${L1}`)).toEqual([
      { videoUrl: 'https://youtu.be/abc123', durationSeconds: 3930, isSample: true },
    ]);
    expect(catalog.bodies(`PUT /api/v1/lessons/${L1}/links`)).toEqual([
      {
        links: [
          { label: 'Slides', url: 'https://exemplo.com/slides.pdf', kind: 'file' },
          { label: 'Documentação', url: 'https://docs.python.org', kind: 'page' },
        ],
      },
    ]);
    expect(router.state.location.search).toBe('?aba=conteudo');
    expect(await screen.findByText('Aula “Variáveis” salva.')).toBeTruthy();
  });

  it('confere os campos antes de enviar: título, endereço, duração e links', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(CONTENT, catalog.respond);
    await user.click(await screen.findByRole('button', { name: 'Nova aula no módulo Projetos' }));
    const box = await screen.findByRole('dialog', { name: 'Nova aula' });
    await user.type(within(box).getByLabelText('Endereço do vídeo'), 'http://exemplo.com/a.mp4');
    await user.type(within(box).getByLabelText('Duração'), 'uma hora');
    await user.click(within(box).getByRole('button', { name: 'Adicionar link' }));
    await user.click(within(box).getByRole('button', { name: 'Criar aula' }));

    expect(within(box).getAllByText('Preencha este campo.')).toHaveLength(3);
    expect(within(box).getByText(/precisa começar com https:\/\//)).toBeTruthy();
    expect(within(box).getByText(/Informe a duração como 12:34/)).toBeTruthy();
    expect(within(box).getByLabelText('Título').getAttribute('aria-invalid')).toBe('true');
    expect(catalog.writes()).toEqual([]);
  });

  it('422 da API aparece no campo: vídeo recusado e link recusado pelo índice', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [filled()],
      overrides: {
        [`POST /api/v1/modules/${M2}/lessons`]: () =>
          problem(422, 'content_url_invalid', {
            errors: [{ path: 'body.videoUrl', message: 'credentials not allowed' }],
          }),
      },
    });
    renderApp(CONTENT, catalog.respond);
    await user.click(await screen.findByRole('button', { name: 'Nova aula no módulo Projetos' }));
    const box = await screen.findByRole('dialog', { name: 'Nova aula' });
    await user.type(within(box).getByLabelText('Título'), 'Jogo da velha');
    await user.type(within(box).getByLabelText('Endereço do vídeo'), 'https://videos.exemplo/a');
    await user.click(within(box).getByRole('button', { name: 'Criar aula' }));

    const video = within(box).getByLabelText('Endereço do vídeo');
    await waitFor(() => expect(video.getAttribute('aria-invalid')).toBe('true'));
    const note = document.getElementById(video.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toMatch(/Endereço fora das regras/);
    // o erro ficou no campo, não num aviso solto
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Nova aula' })).toBeTruthy();
  });

  it('link recusado pela API aparece no link; salvar de novo não cria a aula outra vez', async () => {
    const user = userEvent.setup();
    let refuse = true;
    const catalog = fakeCatalog({ courses: [filled()] });
    const respond = (request: Request) => {
      if (refuse && request.method === 'PUT' && request.url.endsWith('/links')) {
        return problem(422, 'content_url_invalid', {
          errors: [{ path: 'body.links.0.url', message: 'host not allowed' }],
        });
      }
      return catalog.respond(request);
    };
    renderApp(CONTENT, respond);
    await user.click(await screen.findByRole('button', { name: 'Nova aula no módulo Projetos' }));
    const box = await screen.findByRole('dialog', { name: 'Nova aula' });
    await user.type(within(box).getByLabelText('Título'), 'Jogo da velha');
    await user.click(within(box).getByRole('button', { name: 'Adicionar link' }));
    await user.type(within(box).getByLabelText('Rótulo'), 'Código');
    await user.type(within(box).getByLabelText('Endereço'), 'https://exemplo.com/codigo.zip');
    await user.click(within(box).getByRole('button', { name: 'Criar aula' }));

    const url = within(box).getByLabelText('Endereço');
    await waitFor(() => expect(url.getAttribute('aria-invalid')).toBe('true'));
    expect(within(box).getByLabelText('Título').getAttribute('aria-invalid')).toBeNull();

    refuse = false;
    await user.click(within(box).getByRole('button', { name: 'Criar aula' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      catalog.writes().filter((call) => call === `POST /api/v1/modules/${M2}/lessons`),
    ).toHaveLength(1);
    expect(catalog.course(COURSE_ID)?.modules[1]?.lessons.map((lesson) => lesson.title)).toEqual([
      'Calculadora',
      'Jogo da velha',
    ]);
  });

  it('aula que não existe mais avisa no diálogo', async () => {
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(`${CONTENT}&aula=sumiu`, catalog.respond);
    const box = await screen.findByRole('dialog', { name: 'Editar a aula' });
    expect(await within(box).findByText(/Aula não encontrada/)).toBeTruthy();
  });
});

describe('editor de curso: dados, capa e certificado', () => {
  it('salva só o que mudou e mostra a prévia da descrição', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    const crumbs = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(crumbs).getByRole('link', { name: 'Cursos' })).toBeTruthy();
    expect(within(crumbs).getByText('Curso de Python')).toBeTruthy();
    expect(button('Salvar').hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText('Descrição'), 'Aprenda **Python**.');
    await user.click(button('Ver prévia da descrição'));
    const preview = screen.getByRole('region', { name: 'Prévia da descrição' });
    expect(preview.querySelector('strong')?.textContent).toBe('Python');
    await user.click(button('Nível: Sem nível'));
    await user.click(screen.getByRole('option', { name: 'Iniciante' }));
    await expectNoAxeViolations();

    await user.click(button('Salvar'));
    expect(await screen.findByText('Dados do curso salvos.')).toBeTruthy();
    expect(catalog.bodies(`PATCH /api/v1/courses/${COURSE_ID}`)).toEqual([
      { description: 'Aprenda **Python**.', level: 'beginner' },
    ]);
    await waitFor(() => expect(button('Salvar').hasAttribute('disabled')).toBe(true));
  });

  it('409 slug_taken e 422 price_required aparecem no campo', async () => {
    const user = userEvent.setup();
    let code: [number, string] = [409, 'slug_taken'];
    const catalog = fakeCatalog({
      courses: [filled()],
      overrides: { [`PATCH /api/v1/courses/${COURSE_ID}`]: () => problem(code[0], code[1]) },
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    const slug = screen.getByLabelText('Endereço (slug)');

    await user.clear(slug);
    await user.type(slug, 'Python Básico');
    await user.click(button('Salvar'));
    expect(await screen.findByText(/Use só minúsculas, números e hífens/)).toBeTruthy();
    expect(catalog.writes()).toEqual([]);

    await user.clear(slug);
    await user.type(slug, 'python');
    await user.click(button('Salvar'));
    await waitFor(() => expect(slug.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText('Este endereço já é usado por outro curso.')).toBeTruthy();

    code = [422, 'price_required'];
    await user.click(button('Modo de acesso: Privado'));
    await user.click(screen.getByRole('option', { name: 'Pago' }));
    const price = screen.getByLabelText('Preço (BRL)');
    await user.type(price, '49,90');
    await user.click(button('Salvar'));
    await waitFor(() => expect(price.getAttribute('aria-invalid')).toBe('true'));
    expect(catalog.bodies(`PATCH /api/v1/courses/${COURSE_ID}`).at(-1)).toEqual({
      slug: 'python',
      accessMode: 'paid',
      priceCents: 4990,
    });
  });

  it('gerente muda o modo de acesso, mas não vê o campo de preço', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'manager',
      courses: [filled({ accessMode: 'paid', priceCents: 4990 })],
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    expect(screen.queryByLabelText(/^Preço/)).toBeNull();
    expect(screen.getByText(/^R\$\s49,90$/)).toBeTruthy();
    expect(screen.getByText('O preço é definido pelo administrador.')).toBeTruthy();

    await user.click(button('Modo de acesso: Pago'));
    await user.click(screen.getByRole('option', { name: 'Aberto' }));
    await user.click(button('Salvar'));
    await waitFor(() =>
      expect(catalog.bodies(`PATCH /api/v1/courses/${COURSE_ID}`)).toEqual([
        { accessMode: 'open' },
      ]),
    );
  });

  it('instrutor não vê modo de acesso nem preço como campos, só o que está gravado', async () => {
    const catalog = fakeCatalog({
      role: 'instructor',
      courses: [filled({ accessMode: 'paid', priceCents: 4990, accessDays: 365 })],
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    expect(screen.queryByRole('button', { name: /^Modo de acesso:/ })).toBeNull();
    expect(screen.queryByLabelText(/^Preço/)).toBeNull();
    expect(screen.queryByLabelText('Dias de acesso')).toBeNull();
    expect(screen.getByText('Pago')).toBeTruthy();
    expect(screen.getByText('365 dias')).toBeTruthy();
    expect(
      screen.getByText(/O modo de acesso é definido por gerente ou administrador/),
    ).toBeTruthy();
  });

  it('envia a capa como product_cover e a grava no curso; remove depois', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    expect(screen.getByText('Sem capa')).toBeTruthy();
    // a capa é 16:9 (spec 029): a moldura da prévia é a larga, sem `style` em linha
    const frame = document.querySelector('.minui-image-picker__frame');
    expect(frame?.getAttribute('data-shape')).toBe('wide');
    expect(frame?.hasAttribute('style')).toBe(false);

    const file = new File(['capa'], 'capa.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('image-picker-input'), file);
    expect(await screen.findByText('Capa salva.')).toBeTruthy();
    expect(catalog.writes()).toEqual(['POST /api/v1/images', `PATCH /api/v1/courses/${COURSE_ID}`]);
    const form = catalog.bodies('POST /api/v1/images')[0] as string;
    expect(form).toMatch(/name="purpose"\r\n\r\nproduct_cover\r\n/);
    expect(form).toMatch(/name="file"; filename="[^"]+"\r\nContent-Type: image\/png/);
    const image = catalog.course(COURSE_ID)?.cover?.imageId;
    expect(catalog.bodies(`PATCH /api/v1/courses/${COURSE_ID}`)[0]).toEqual({
      coverImageId: image,
    });
    const shown = await screen.findByRole('img', { name: 'Capa de Curso de Python' });
    expect(shown.getAttribute('src')).toBe(`/api/v1/images/${image}/480.webp`);

    await user.click(button('Remover a capa'));
    expect(await screen.findByText('Capa removida.')).toBeTruthy();
    expect(catalog.bodies(`PATCH /api/v1/courses/${COURSE_ID}`)[1]).toEqual({ coverImageId: null });
  });

  it('capa recusada pela API mostra o motivo no seletor', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [filled()],
      overrides: { 'POST /api/v1/images': () => problem(422, 'image_too_heavy') },
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    await user.upload(
      screen.getByTestId('image-picker-input'),
      new File(['capa'], 'capa.png', { type: 'image/png' }),
    );
    expect(await screen.findByText(/A imagem ficou pesada demais/)).toBeTruthy();
    expect(catalog.writes()).toEqual(['POST /api/v1/images']);
  });

  it('certificado: habilita e fixa a carga horária', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(`${PATH}?aba=certificado`, catalog.respond);
    await heading('Curso de Python');
    expect(screen.getByRole('tab', { name: 'Certificado' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await user.click(
      screen.getByRole('switch', { name: 'Emitir certificado ao concluir o curso' }),
    );
    const hours = screen.getByLabelText('Carga horária (horas)');
    await user.type(hours, '0');
    await user.click(button('Salvar'));
    expect(await screen.findByText(/Informe um número inteiro de 1 a 10.000/)).toBeTruthy();
    await user.clear(hours);
    await user.type(hours, '40');
    await user.click(button('Salvar'));
    expect(await screen.findByText('Certificado do curso salvo.')).toBeTruthy();
    expect(catalog.bodies(`PATCH /api/v1/courses/${COURSE_ID}`)).toEqual([
      { certificateEnabled: true, certificateHours: 40 },
    ]);
    await expectNoAxeViolations();
  });
});

describe('editor de curso: publicação, arquivo e exclusão', () => {
  it('admin publica; curso sem aula publicada é recusado com o motivo', async () => {
    const user = userEvent.setup();
    let refuse = true;
    const catalog = fakeCatalog({ courses: [filled()] });
    renderApp(PATH, (request: Request) =>
      refuse && request.url.endsWith('/publish')
        ? problem(422, 'course_has_no_published_lesson')
        : catalog.respond(request),
    );
    await heading('Curso de Python');
    await user.click(button('Publicar'));
    let confirm = await screen.findByRole('alertdialog', { name: 'Publicar o curso?' });
    await user.click(within(confirm).getByRole('button', { name: 'Publicar' }));
    expect(
      await screen.findByText(/precisa de ao menos um módulo com uma aula publicada/),
    ).toBeTruthy();

    refuse = false;
    await user.click(button('Publicar'));
    confirm = await screen.findByRole('alertdialog', { name: 'Publicar o curso?' });
    await user.click(within(confirm).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('Curso publicado.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Despublicar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
  });

  it('despublicar mostra o número de alunos afetados', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [filled({ status: 'published', studentCount: 12 })],
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    await user.click(button('Despublicar'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Despublicar o curso?' });
    expect(within(confirm).getByText(/12 alunos com acesso deixam de vê-lo/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Despublicar' }));
    expect(await screen.findByText('Curso despublicado.')).toBeTruthy();
    expect(catalog.writes()).toEqual([`POST /api/v1/courses/${COURSE_ID}/unpublish`]);
  });

  it('só o admin arquiva e desarquiva; curso com alunos não oferece excluir', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled({ studentCount: 3 })] });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await user.click(button('Arquivar'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Arquivar o curso?' });
    expect(within(confirm).getByText(/3 alunos com acesso deixam de vê-lo/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Arquivar' }));
    expect(await screen.findByText('Curso arquivado.')).toBeTruthy();
    expect(await screen.findByText(/está fora do site do aluno/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();

    await user.click(button('Desarquivar'));
    const back = await screen.findByRole('alertdialog', { name: 'Desarquivar o curso?' });
    await user.click(within(back).getByRole('button', { name: 'Desarquivar' }));
    expect(await screen.findByRole('button', { name: 'Arquivar' })).toBeTruthy();
    expect(catalog.writes()).toEqual([
      `POST /api/v1/courses/${COURSE_ID}/archive`,
      `POST /api/v1/courses/${COURSE_ID}/unarchive`,
    ]);
  });

  it('gerente não vê arquivar; excluir recusado com vínculos manda arquivar', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'manager',
      courses: [filled()],
      overrides: {
        [`DELETE /api/v1/courses/${COURSE_ID}`]: () => problem(409, 'product_has_links'),
      },
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    expect(screen.queryByRole('button', { name: 'Arquivar' })).toBeNull();
    await user.click(button('Excluir'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Excluir o curso?' });
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText(/não pode ser excluído. Use arquivar\./)).toBeTruthy();
    expect(await heading('Curso de Python')).toBeTruthy();
  });

  it('excluir curso sem vínculos volta à lista', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [filled()] });
    const { router } = renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    await user.click(button('Excluir'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Excluir o curso?' });
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cursos'));
    expect(await screen.findByText('Nenhum curso ainda')).toBeTruthy();
    expect(catalog.course(COURSE_ID)).toBeUndefined();
  });

  it('instrutor de curso pago envia para publicação e cancela; não publica nem arquiva', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'instructor',
      courses: [filled({ accessMode: 'paid', priceCents: 4990 })],
    });
    renderApp(CONTENT, catalog.respond);
    await heading('Curso de Python');
    await findMenu();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arquivar' })).toBeNull();
    // aula de curso pago: o instrutor não publica (spec 009, "Autoria")
    expect(screen.queryByRole('button', { name: 'Publicar a aula Variáveis' })).toBeNull();

    await user.click(button('Enviar para publicação'));
    expect(await screen.findByText('Curso enviado para publicação.')).toBeTruthy();
    expect(screen.getByText(/Um gerente ou administrador publica o curso/)).toBeTruthy();
    await user.click(button('Cancelar o pedido de publicação'));
    expect(await screen.findByRole('button', { name: 'Enviar para publicação' })).toBeTruthy();
    expect(catalog.writes()).toEqual([
      `POST /api/v1/courses/${COURSE_ID}/request-review`,
      `DELETE /api/v1/courses/${COURSE_ID}/request-review`,
    ]);
  });

  it('instrutor publica direto o curso aberto de que é dono', async () => {
    const catalog = fakeCatalog({ role: 'instructor', courses: [filled({ accessMode: 'open' })] });
    renderApp(CONTENT, catalog.respond);
    await heading('Curso de Python');
    expect(button('Publicar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar para publicação' })).toBeNull();
    expect(button('Publicar a aula Variáveis')).toBeTruthy();
  });

  it('gerente vê o pedido de publicação e publica', async () => {
    const catalog = fakeCatalog({
      role: 'manager',
      courses: [filled({ reviewRequestedAt: '2026-11-21T12:00:00Z' })],
    });
    renderApp(PATH, catalog.respond);
    await heading('Curso de Python');
    expect(screen.getByText(/Revise o curso e publique\./)).toBeTruthy();
    expect(button('Publicar')).toBeTruthy();
  });

  it('curso que não existe (ou alheio ao instrutor) mostra "não encontrado"', async () => {
    renderApp('/cursos/nao-existe', fakeCatalog({ role: 'instructor' }).respond);
    expect(await screen.findByText('Curso não encontrado')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar aos cursos' }).getAttribute('href')).toBe(
      '/cursos',
    );
  });
});
