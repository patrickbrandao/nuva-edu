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
      { authorName: 'Ana Autora', fileUrl: 'https://exemplo.com/guia.pdf', pages: 120 },
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
    expect(manager.bodies(`PATCH /api/v1/ebooks/${EBOOK_ID}`)).toEqual([{ accessMode: 'paid' }]);
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
    expect(catalog.bodies(`PUT /api/v1/ebooks/${EBOOK_ID}/targets`)).toEqual([
      { targets: [{ targetType: 'lesson', targetId: LESSON }] },
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

    expect(catalog.bodies(`PUT /api/v1/bundles/${id}/items`)).toEqual([
      { items: [{ productType: 'course', productId: COURSE_ID }] },
      {
        items: [
          { productType: 'course', productId: COURSE_ID },
          { productType: 'ebook', productId: EBOOK_ID },
        ],
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
      { items: [{ productType: 'course', productId: COURSE_ID }] },
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
    expect(catalog.bodies(`PUT /api/v1/ebooks/${EBOOK_ID}/targets`)).toEqual([
      { targets: [{ targetType: 'course', targetId: COURSE_ID }] },
    ]);
    const row = within(list).getByText('Guia de Python').closest('li') as HTMLElement;
    expect(within(row).getByText('Vinculado')).toBeTruthy();
    expect(
      within(list).getByRole('button', { name: 'Vincular o ebook Apostila de SQL' }),
    ).toBeTruthy();
    // só escritas de vínculo: nada em ebook nem em pacote
    expect(catalog.writes()).toEqual([`PUT /api/v1/ebooks/${EBOOK_ID}/targets`]);
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
    const course = { targetType: 'course', targetId: COURSE_ID };
    expect(catalog.bodies(`PUT /api/v1/ebooks/${EBOOK_ID}/targets`)).toEqual([
      { targets: [course, { targetType: 'lesson', targetId: LESSON }] },
      { targets: [course] },
    ]);
    // o formulário da aula não foi enviado
    expect(catalog.writes().some((entry) => entry.includes('/lessons/'))).toBe(false);
  });
});
