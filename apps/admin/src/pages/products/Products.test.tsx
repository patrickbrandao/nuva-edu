import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import {
  BUNDLE_ID,
  bundleDetail,
  COURSE_ID,
  courseDetail,
  courseModule,
  EBOOK_ID,
  ebookDetail,
  fakeCatalog,
  lessonSummary,
  stubSortableLayout,
} from '../../test/courses';
import { findMenu, renderApp } from '../../test/render';

const EBOOK2 = '0193a5b2-0000-7000-8000-0000000000b2';
const LESSON = '0193a5b2-0000-7000-8000-0000000000f1';
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

const COURSE = courseDetail({
  accessMode: 'paid',
  priceCents: 9900,
  status: 'published',
  moduleCount: 1,
  modules: [courseModule({ lessons: [lessonSummary({ id: LESSON, title: 'Variáveis' })] })],
});
const GUIDE = ebookDetail({ accessMode: 'paid', priceCents: 2990, status: 'published' });
const item = (overrides: object) => ({
  productType: 'course' as const,
  productId: COURSE_ID,
  title: 'Curso de Python',
  accessMode: 'paid' as const,
  priceCents: 9900,
  status: 'published' as const,
  archived: false,
  position: 0,
  ...overrides,
});
const FILLED = bundleDetail({
  studentCount: 3,
  itemCount: 2,
  itemsPriceCents: 12890,
  items: [
    item({}),
    item({
      productType: 'ebook',
      productId: EBOOK_ID,
      title: 'Guia de Python',
      priceCents: 2990,
      position: 1,
    }),
  ],
});

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubSortableLayout();
});
afterEach(() => restoreLayout());

describe('ebooks (/ebooks)', () => {
  it('lista os ebooks e cria um, que abre no editor, sem violações do axe', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      ebooks: [ebookDetail({ authorName: 'Ana Autora', pages: 120 })],
    });
    renderApp('/ebooks', catalog.respond);

    const table = (await screen.findByRole('table')) as HTMLElement;
    const link = within(table).getByRole('link', { name: 'Guia de Python' });
    expect(link.getAttribute('href')).toBe(`/ebooks/${EBOOK_ID}`);
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('Rascunho')).toBeTruthy();
    expect(within(row).getByText('Ana Autora · 120 páginas')).toBeTruthy();
    await expectNoAxeViolations();

    await user.click(button('Novo ebook'));
    const box = await screen.findByRole('dialog', { name: 'Novo ebook' });
    await user.type(within(box).getByLabelText('Título'), 'Apostila de SQL');
    await user.click(within(box).getByRole('button', { name: 'Criar ebook' }));
    await heading('Apostila de SQL');
    expect(catalog.bodies('POST /api/v1/ebooks')).toEqual([{ title: 'Apostila de SQL' }]);
  });

  it('salva só o que mudou, recusa endereço fora das regras e exige o arquivo para publicar', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ ebooks: [ebookDetail()] });
    renderApp(`/ebooks/${EBOOK_ID}`, catalog.respond);
    await heading('Guia de Python');

    await user.click(button('Publicar'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Publicar o ebook?' });
    await user.click(within(confirm).getByRole('button', { name: 'Publicar' }));
    expect(
      await screen.findByText('Para publicar, o ebook precisa do endereço do arquivo.'),
    ).toBeTruthy();

    const file = screen.getByLabelText('Endereço do arquivo');
    await user.type(file, 'http://exemplo.com/guia.pdf');
    await user.click(button('Salvar'));
    expect(await screen.findByText(/^Endereço fora das regras/)).toBeTruthy();
    expect(catalog.bodies(`PATCH /api/v1/ebooks/${EBOOK_ID}`)).toEqual([]);

    await user.clear(file);
    await user.type(file, 'https://exemplo.com/guia.pdf');
    await user.type(screen.getByLabelText('Autor'), 'Ana Autora');
    await user.type(screen.getByLabelText('Páginas'), '120');
    await user.click(button('Salvar'));
    await screen.findByText('Dados do ebook salvos.');
    expect(catalog.bodies(`PATCH /api/v1/ebooks/${EBOOK_ID}`)).toEqual([
      {
        authorName: 'Ana Autora',
        fileUrl: 'https://exemplo.com/guia.pdf',
        pages: 120,
        version: 1,
      },
    ]);

    await user.click(button('Publicar'));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar' }),
    );
    await screen.findByText('Ebook publicado.');
    expect(catalog.ebook(EBOOK_ID)?.status).toBe('published');
  });

  it('gerente muda o modo de acesso, mas não vê preço nem arquivar; admin arquiva', async () => {
    const user = userEvent.setup();
    const manager = fakeCatalog({ role: 'manager', ebooks: [ebookDetail()] });
    const first = renderApp(`/ebooks/${EBOOK_ID}`, manager.respond);
    await heading('Guia de Python');
    expect(screen.queryByRole('button', { name: 'Arquivar' })).toBeNull();
    await user.click(button('Modo de acesso: Privado'));
    await user.click(screen.getByRole('option', { name: 'Pago' }));
    expect(screen.queryByLabelText(/^Preço/)).toBeNull();
    expect(screen.getByText('O preço é definido pelo administrador.')).toBeTruthy();
    await user.click(button('Salvar'));
    await screen.findByText('Dados do ebook salvos.');
    expect(manager.bodies(`PATCH /api/v1/ebooks/${EBOOK_ID}`)).toEqual([
      { accessMode: 'paid', version: 1 },
    ]);
    first.unmount();

    const admin = fakeCatalog({ ebooks: [ebookDetail({ studentCount: 2 })] });
    renderApp(`/ebooks/${EBOOK_ID}`, admin.respond);
    await heading('Guia de Python');
    // com alunos, não há excluir: o caminho é arquivar
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await user.click(button('Arquivar'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Arquivar o ebook?' });
    expect(within(confirm).getByText(/2 alunos com acesso deixam de vê-lo/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Arquivar' }));
    await screen.findByText('Ebook arquivado.');
    expect(admin.writes()).toEqual([`POST /api/v1/ebooks/${EBOOK_ID}/archive`]);
    expect(button('Desarquivar')).toBeTruthy();
  });

  it('a aba de vínculos mostra onde o ebook está e desvincula', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [COURSE],
      ebooks: [
        ebookDetail({
          targets: [
            { targetType: 'course', targetId: COURSE_ID, title: 'Curso de Python', course: null },
            {
              targetType: 'lesson',
              targetId: LESSON,
              title: 'Variáveis',
              course: { type: 'course', id: COURSE_ID, title: 'Curso de Python' },
            },
            { targetType: 'bundle', targetId: BUNDLE_ID, title: 'Trilha Python', course: null },
          ],
        }),
      ],
    });
    renderApp(`/ebooks/${EBOOK_ID}?aba=vinculos`, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Onde o ebook está vinculado' });
    expect(within(list).getByRole('link', { name: 'Variáveis' }).getAttribute('href')).toBe(
      `/cursos/${COURSE_ID}?aula=${LESSON}`,
    );
    // o vínculo a pacote é item do pacote: não se desfaz daqui
    expect(within(list).queryByRole('button', { name: 'Desvincular Trilha Python' })).toBeNull();

    await user.click(within(list).getByRole('button', { name: 'Desvincular Curso de Python' }));
    await screen.findByText('Ebook desvinculado de “Curso de Python”.');
    // só os vínculos de curso e de aula vão no corpo: o de pacote a API preserva
    expect(catalog.bodies(`PUT /api/v1/ebooks/${EBOOK_ID}/targets`)).toEqual([
      { targets: [{ targetType: 'lesson', targetId: LESSON }], version: 1 },
    ]);
    expect(catalog.ebook(EBOOK_ID)?.targets.map((target) => target.targetType)).toEqual([
      'lesson',
      'bundle',
    ]);
    expect(within(list).queryByRole('link', { name: 'Curso de Python' })).toBeNull();
    await expectNoAxeViolations();
  });
});

describe('capa de ebook e de pacote', () => {
  it.each([
    ['ebook', `/ebooks/${EBOOK_ID}`, 'Guia de Python'],
    ['pacote', `/pacotes/${BUNDLE_ID}`, 'Trilha Python'],
  ])('a prévia da capa do %s é 16:9, sem `style` em linha', async (_kind, path, title) => {
    const cover = {
      imageId: '0193a5b2-0000-7000-8000-0000000000aa',
      url: '/api/v1/images/capa/480.webp',
      largeUrl: '/api/v1/images/capa/1280.webp',
    };
    const catalog = fakeCatalog({
      ebooks: [ebookDetail({ cover })],
      bundles: [bundleDetail({ cover })],
    });
    renderApp(path, catalog.respond);
    await heading(title);
    const frame = document.querySelector('.minui-image-picker__frame');
    expect(frame?.getAttribute('data-shape')).toBe('wide');
    expect(frame?.hasAttribute('style')).toBe(false);
    expect(frame?.querySelector('img')?.getAttribute('src')).toBe(cover.url);
    expect(frame?.querySelector('img')?.hasAttribute('style')).toBe(false);
  });
});

describe('pacotes (/pacotes)', () => {
  it('cria o pacote, adiciona curso e ebook e só então publica', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [COURSE], ebooks: [GUIDE] });
    renderApp('/pacotes', catalog.respond);
    await screen.findByText('Nenhum pacote ainda');
    await user.click(screen.getAllByRole('button', { name: 'Novo pacote' })[0] as HTMLElement);
    const box = await screen.findByRole('dialog', { name: 'Novo pacote' });
    await user.type(within(box).getByLabelText('Título'), 'Trilha de dados');
    await user.click(within(box).getByRole('button', { name: 'Criar pacote' }));
    await heading('Trilha de dados');
    const id = catalog.bodies('POST /api/v1/bundles').length
      ? (catalog.requests.find((entry) => entry.path.startsWith('/api/v1/bundles/'))?.path ?? '')
          .split('/')
          .pop()
      : '';

    await user.click(button('Publicar'));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar' }),
    );
    expect(
      await screen.findByText('Para publicar, o pacote precisa de ao menos um item.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Itens' }));
    await user.click(button('Adicionar itens'));
    const picker = await screen.findByRole('dialog', { name: 'Adicionar itens ao pacote' });
    await user.click(
      await within(picker).findByRole('button', { name: 'Adicionar Curso de Python ao pacote' }),
    );
    await within(picker).findByText('Já no pacote');
    await user.click(within(picker).getByRole('button', { name: 'Tipo de item: Cursos' }));
    await user.click(screen.getByRole('option', { name: 'Ebooks' }));
    await user.click(
      await within(picker).findByRole('button', { name: 'Adicionar Guia de Python ao pacote' }),
    );
    await within(picker).findByText('Já no pacote');
    await user.click(within(picker).getByRole('button', { name: 'Concluir' }));

    // cada troca leva o `version` da resposta anterior (a criação e a recusa ao publicar não
    // gravam nada)
    expect(catalog.bodies(`PUT /api/v1/bundles/${id}/items`)).toEqual([
      { items: [{ productType: 'course', productId: COURSE_ID }], version: 1 },
      {
        items: [
          { productType: 'course', productId: COURSE_ID },
          { productType: 'ebook', productId: EBOOK_ID },
        ],
        version: 2,
      },
    ]);
    // a soma dos preços avulsos evidencia a economia
    expect(await screen.findByText(/^R\$\s128,90$/)).toBeTruthy();

    await user.click(button('Publicar'));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar' }),
    );
    await screen.findByText('Pacote publicado.');
  });

  it('remover item pede confirmação com o número de alunos e só grava depois dela', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ courses: [COURSE], ebooks: [GUIDE], bundles: [FILLED] });
    renderApp(`/pacotes/${BUNDLE_ID}?aba=itens`, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Itens do pacote, na ordem' });
    expect(screen.getByText('3 alunos')).toBeTruthy();

    await user.click(
      within(list).getByRole('button', { name: 'Remover Guia de Python do pacote' }),
    );
    let confirm = await screen.findByRole('alertdialog', { name: 'Remover o item do pacote?' });
    expect(within(confirm).getByText(/Guia de Python/)).toBeTruthy();
    expect(
      within(confirm).getByText(/3 alunos têm o pacote e perdem o acesso a este item/),
    ).toBeTruthy();
    await expectNoAxeViolations();
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(catalog.writes()).toEqual([]);

    await user.click(
      within(list).getByRole('button', { name: 'Remover Guia de Python do pacote' }),
    );
    confirm = await screen.findByRole('alertdialog', { name: 'Remover o item do pacote?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remover do pacote' }));
    await screen.findByText('“Guia de Python” removido do pacote.');
    expect(catalog.bodies(`PUT /api/v1/bundles/${BUNDLE_ID}/items`)).toEqual([
      { items: [{ productType: 'course', productId: COURSE_ID }], version: 1 },
    ]);
    expect(catalog.bundle(BUNDLE_ID)?.items.map((entry) => entry.title)).toEqual([
      'Curso de Python',
    ]);
  });

  it('pacote sem alunos diz isso na confirmação; a ordem dos itens é gravada pelo teclado', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [COURSE],
      ebooks: [GUIDE],
      bundles: [{ ...FILLED, studentCount: 0 }],
    });
    renderApp(`/pacotes/${BUNDLE_ID}?aba=itens`, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Itens do pacote, na ordem' });

    within(list).getByRole('button', { name: 'Mover Guia de Python' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    await waitFor(() =>
      expect(catalog.bodies(`PUT /api/v1/bundles/${BUNDLE_ID}/items`)).toEqual([
        {
          items: [
            { productType: 'ebook', productId: EBOOK_ID },
            { productType: 'course', productId: COURSE_ID },
          ],
          version: 1,
        },
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'Remover Curso de Python do pacote' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/Nenhum aluno tem o pacote hoje/)).toBeTruthy();
  });
});

describe('vínculo de ebooks no curso e na aula', () => {
  it('instrutor só vincula: sem telas de ebook e de pacote, e o vínculo vai pelo curso', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      role: 'instructor',
      courses: [COURSE],
      ebooks: [GUIDE, ebookDetail({ id: EBOOK2, slug: 'sql', title: 'Apostila de SQL' })],
    });
    const first = renderApp('/ebooks', catalog.respond);
    const menu = await findMenu();
    expect(within(menu).queryByRole('link', { name: 'Ebooks' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Pacotes' })).toBeNull();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    first.unmount();
    const second = renderApp(`/pacotes/${BUNDLE_ID}`, catalog.respond);
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    second.unmount();
    expect(catalog.requests.some((entry) => entry.path.includes('/bundles'))).toBe(false);

    renderApp(`/cursos/${COURSE_ID}?aba=ebooks`, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Ebooks para o curso Curso de Python' });
    // vê o ebook, mas não o abre para editar nem cria outro
    expect(within(list).getByText('Guia de Python')).toBeTruthy();
    expect(within(list).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo ebook' })).toBeNull();

    await user.click(
      await within(list).findByRole('button', { name: 'Vincular o ebook Guia de Python' }),
    );
    await screen.findByText('Ebook “Guia de Python” vinculado.');
    const row = within(list).getByText('Guia de Python').closest('li') as HTMLElement;
    expect(within(row).getByText('Vinculado')).toBeTruthy();
    expect(
      within(list).getByRole('button', { name: 'Vincular o ebook Apostila de SQL' }),
    ).toBeTruthy();
    // um vínculo só, sem reenviar a lista: nada em ebook nem em pacote
    expect(catalog.writes()).toEqual([
      `PUT /api/v1/ebooks/${EBOOK_ID}/targets/course/${COURSE_ID}`,
    ]);
    expect(catalog.ebook(EBOOK_ID)?.targets.map((target) => target.targetId)).toEqual([COURSE_ID]);
    await expectNoAxeViolations();
  });

  it('na aula, vincula e desvincula mantendo os outros vínculos do ebook', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [COURSE],
      ebooks: [
        ebookDetail({
          targets: [
            { targetType: 'course', targetId: COURSE_ID, title: 'Curso de Python', course: null },
          ],
        }),
      ],
    });
    renderApp(`/cursos/${COURSE_ID}?aula=${LESSON}`, catalog.respond);
    // o diálogo troca de corpo quando a aula chega: a lista é procurada na página
    const list = await screen.findByRole('list', { name: 'Ebooks para a aula Variáveis' });
    expect(list.closest('[role="dialog"]')).toBeTruthy();

    await user.click(
      await within(list).findByRole('button', { name: 'Vincular o ebook Guia de Python' }),
    );
    await within(list).findByRole('button', { name: 'Desvincular Guia de Python' });
    await user.click(within(list).getByRole('button', { name: 'Desvincular Guia de Python' }));
    await within(list).findByRole('button', { name: 'Vincular o ebook Guia de Python' });
    expect(catalog.writes()).toEqual([
      `PUT /api/v1/ebooks/${EBOOK_ID}/targets/lesson/${LESSON}`,
      `DELETE /api/v1/ebooks/${EBOOK_ID}/targets/lesson/${LESSON}`,
    ]);
    // o vínculo com o curso ficou como estava
    expect(catalog.ebook(EBOOK_ID)?.targets.map((target) => target.targetType)).toEqual(['course']);
    // o formulário da aula não foi enviado
    expect(catalog.writes().some((entry) => entry.includes('/lessons/'))).toBe(false);
  });
});

describe('ebooks vinculados vêm do curso', () => {
  it('os vinculados aparecem primeiro, mesmo fora da busca, sem uma leitura por ebook', async () => {
    const user = userEvent.setup();
    const sql = ebookDetail({
      id: EBOOK2,
      slug: 'sql',
      title: 'Apostila de SQL',
      status: 'published',
      targets: [
        { targetType: 'course', targetId: COURSE_ID, title: 'Curso de Python', course: null },
      ],
    });
    const catalog = fakeCatalog({ courses: [COURSE], ebooks: [GUIDE, sql] });
    renderApp(`/cursos/${COURSE_ID}?aba=ebooks`, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Ebooks para o curso Curso de Python' });
    await within(list).findByRole('button', { name: 'Vincular o ebook Guia de Python' });
    const titles = () =>
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('a, span')?.textContent);
    expect(titles()).toEqual(['Apostila de SQL', 'Guia de Python']);

    // a busca não acha o vinculado, e ele continua em primeiro
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar ebook por título ou resumo' }),
      'Guia{Enter}',
    );
    await waitFor(() => expect(catalog.requests.at(-1)?.query.get('q')).toBe('Guia'));
    expect(titles()).toEqual(['Apostila de SQL', 'Guia de Python']);
    const linked = within(list).getByText('Apostila de SQL').closest('li') as HTMLElement;
    expect(within(linked).getByText('Vinculado')).toBeTruthy();

    await user.click(within(list).getByRole('button', { name: 'Desvincular Apostila de SQL' }));
    await screen.findByText('Ebook “Apostila de SQL” desvinculado.');
    expect(catalog.writes()).toEqual([
      `DELETE /api/v1/ebooks/${EBOOK2}/targets/course/${COURSE_ID}`,
    ]);
    // o vínculo de cada ebook vem do curso: nenhum `GET /ebooks/{id}`
    expect(
      catalog.requests.some(
        (entry) => entry.method === 'GET' && /^\/api\/v1\/ebooks\/./.test(entry.path),
      ),
    ).toBe(false);
  });
});

describe('conflito de edição (409 version_conflict) em ebook e pacote', () => {
  const TITLE = 'Este item foi alterado por outra pessoa';
  const conflict = async () =>
    (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement;
  const noConflict = () => waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());

  it('ebook: avisa sem perder o que foi digitado e grava depois de recarregar', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({ ebooks: [ebookDetail()] });
    renderApp(`/ebooks/${EBOOK_ID}`, catalog.respond);
    await heading('Guia de Python');
    const author = screen.getByLabelText('Autor') as HTMLInputElement;
    await user.type(author, 'Ana Autora');
    const stored = catalog.ebook(EBOOK_ID);
    if (!stored) throw new Error('ebook ausente');
    Object.assign(stored, { pages: 80, version: 3 });

    await user.click(button('Salvar'));
    await user.click(within(await conflict()).getByRole('button', { name: 'Recarregar' }));
    await noConflict();
    expect(author.value).toBe('Ana Autora');
    expect((screen.getByLabelText('Páginas') as HTMLInputElement).value).toBe('80');
    await user.click(button('Salvar'));
    await screen.findByText('Dados do ebook salvos.');
    expect(catalog.bodies(`PATCH /api/v1/ebooks/${EBOOK_ID}`)).toEqual([
      { authorName: 'Ana Autora', version: 1 },
      { authorName: 'Ana Autora', version: 3 },
    ]);
  });

  it('ebook: desvincular com conflito avisa e, depois de recarregar, grava', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [COURSE],
      ebooks: [
        ebookDetail({
          targets: [
            { targetType: 'course', targetId: COURSE_ID, title: 'Curso de Python', course: null },
          ],
        }),
      ],
    });
    renderApp(`/ebooks/${EBOOK_ID}?aba=vinculos`, catalog.respond);
    const list = await screen.findByRole('list', { name: 'Onde o ebook está vinculado' });
    const stored = catalog.ebook(EBOOK_ID);
    if (stored) stored.version = 2;
    await user.click(within(list).getByRole('button', { name: 'Desvincular Curso de Python' }));
    await user.click(within(await conflict()).getByRole('button', { name: 'Recarregar' }));
    await noConflict();
    await user.click(within(list).getByRole('button', { name: 'Desvincular Curso de Python' }));
    await screen.findByText('Ebook desvinculado de “Curso de Python”.');
    expect(catalog.bodies(`PUT /api/v1/ebooks/${EBOOK_ID}/targets`)).toEqual([
      { targets: [], version: 1 },
      { targets: [], version: 2 },
    ]);
  });

  it('pacote: dados e itens avisam o conflito; a ordem gravada volta e nada é reenviado', async () => {
    const user = userEvent.setup();
    const catalog = fakeCatalog({
      courses: [COURSE],
      ebooks: [GUIDE],
      bundles: [{ ...FILLED, studentCount: 0 }],
    });
    renderApp(`/pacotes/${BUNDLE_ID}`, catalog.respond);
    await heading('Trilha Python');
    const title = screen.getByLabelText('Título') as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Trilha de dados');
    const stored = catalog.bundle(BUNDLE_ID);
    if (!stored) throw new Error('pacote ausente');
    stored.version = 2;
    await user.click(button('Salvar'));
    await user.click(within(await conflict()).getByRole('button', { name: 'Recarregar' }));
    await noConflict();
    expect(title.value).toBe('Trilha de dados');
    await user.click(button('Salvar'));
    await screen.findByText('Dados do pacote salvos.');
    expect(catalog.bodies(`PATCH /api/v1/bundles/${BUNDLE_ID}`)).toEqual([
      { title: 'Trilha de dados', version: 1 },
      { title: 'Trilha de dados', version: 2 },
    ]);

    await user.click(screen.getByRole('tab', { name: 'Itens' }));
    const list = await screen.findByRole('list', { name: 'Itens do pacote, na ordem' });
    stored.version = 9;
    within(list).getByRole('button', { name: 'Mover Guia de Python' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    const alert = await conflict();
    const order = () =>
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent);
    await waitFor(() => expect(order()).toEqual(['Curso de Python', 'Guia de Python']));
    expect(catalog.bodies(`PUT /api/v1/bundles/${BUNDLE_ID}/items`)).toHaveLength(1);
    await user.click(within(alert).getByRole('button', { name: 'Recarregar' }));
    await noConflict();

    await user.click(screen.getByRole('button', { name: 'Remover Curso de Python do pacote' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Remover do pacote' }));
    await screen.findByText('“Curso de Python” removido do pacote.');
    expect(catalog.bodies(`PUT /api/v1/bundles/${BUNDLE_ID}/items`).at(-1)).toEqual({
      items: [{ productType: 'ebook', productId: EBOOK_ID }],
      version: 9,
    });
  });
});
