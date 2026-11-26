import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courseTemplatePath } from '../../../api/certificates';
import {
  ADMIN_ID,
  calls,
  defaultRoutes,
  problem,
  type Routes,
  type StaffRole,
} from '../../../test/api';
import { expectNoAxeViolations } from '../../../test/axe';
import { COURSE_ID, courseDetail, INSTRUCTOR } from '../../../test/courses';
import { renderApp } from '../../../test/render';

// o endereço para onde a recusa `certificate_template_missing` aponta (tarefa 443)
const PATH = courseTemplatePath(COURSE_ID);
const TEMPLATE_URL = `/api/v1/courses/${COURSE_ID}/certificate-template`;
const VERSION = '0193a5b2-0000-7000-8000-0000000007a1';
const VERSION_2 = '0193a5b2-0000-7000-8000-0000000007a2';
const PREVIEW_ID = '0193a5b2-0000-7000-8000-0000000007b1';
const NOW = '2026-11-20T12:00:00Z';
const MODEL = '<h1>{{curso.titulo}}</h1>\n<p>{{aluno.nome}}</p>\n<p>{{certificado.codigo}}</p>';

const REFERENCE = {
  keys: [
    {
      key: 'aluno.nome',
      placeholder: '{{aluno.nome}}',
      description: 'Nome do aluno',
      example: 'Maria Exemplo da Silva',
      required: true,
      requiredOneOf: false,
    },
    {
      key: 'certificado.qrcode',
      placeholder: '{{certificado.qrcode}}',
      description: 'Código QR da URL de validação',
      example: 'Código QR da validação',
      required: false,
      requiredOneOf: true,
    },
  ],
  modelHtml: MODEL,
};

const NONE = { source: 'none', html: null, versionId: null, updatedAt: null, updatedBy: null };
const OWN = {
  source: 'course',
  html: '<p>{{aluno.nome}}</p>',
  versionId: VERSION,
  updatedAt: NOW,
  updatedBy: { id: INSTRUCTOR.id, name: 'Ivo Instrutor' },
};

function preview(status: 'pending' | 'ready' | 'failed', error: string | null = null) {
  return {
    id: PREVIEW_ID,
    courseId: COURSE_ID,
    status,
    error,
    createdAt: NOW,
    renderedAt: status === 'pending' ? null : NOW,
    expiresAt: '2026-11-21T12:00:00Z',
  };
}

function open(overrides: Routes = {}, role: StaffRole = 'admin', course = courseDetail()) {
  const bodies: Record<string, unknown>[] = [];
  const routes: Routes = {
    ...defaultRoutes(role),
    [`GET /api/v1/courses/${COURSE_ID}`]: course,
    [`GET ${TEMPLATE_URL}`]: NONE,
    'GET /api/v1/certificate-templates/reference': REFERENCE,
    [`PUT ${TEMPLATE_URL}`]: async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return {
        source: 'course',
        html: body.html,
        versionId: VERSION_2,
        updatedAt: NOW,
        updatedBy: { id: INSTRUCTOR.id, name: 'Ana Admin' },
        backfillQueued: body.expectedVersionId === null,
      };
    },
    ...overrides,
  };
  return { ...renderApp(PATH, routes), bodies };
}

const editor = () =>
  screen.findByRole('textbox', { name: 'HTML do template' }) as Promise<HTMLTextAreaElement>;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => openSpy.mockRestore());

describe('template do certificado no editor de curso', () => {
  it('sem template: avisa, começa do modelo pelo teclado, salva e avisa da emissão retroativa; axe limpo', async () => {
    const user = userEvent.setup();
    const { bodies } = open();
    const box = await editor();
    expect(await screen.findByText('Sem template')).toBeTruthy();
    expect(screen.getByText(/Sem template, o certificado não é emitido/)).toBeTruthy();
    // palavras-chave com descrição, exemplo e copiar
    const keys = await screen.findByRole('list', { name: 'Palavras-chave' });
    expect(within(keys).getByText('{{aluno.nome}}', { selector: 'code' })).toBeTruthy();
    expect(within(keys).getByText('Nome do aluno')).toBeTruthy();
    expect(within(keys).getByText('Obrigatória')).toBeTruthy();
    expect(within(keys).getByText('Ao menos uma destas')).toBeTruthy();
    await expectNoAxeViolations();

    // editor vazio: o modelo entra sem confirmação
    await waitFor(() =>
      expect((button('Começar do modelo') as HTMLButtonElement).disabled).toBe(false),
    );
    button('Começar do modelo').focus();
    await user.keyboard('{Enter}');
    expect(box.value).toBe(MODEL);
    // números de linha
    expect(document.querySelector('.nuva-code__gutter')?.textContent).toBe('1\n2\n3');

    button('Salvar template').focus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('Os alunos que já concluíram vão receber o certificado.'),
    ).toBeTruthy();
    expect(bodies).toEqual([{ html: MODEL, expectedVersionId: null }]);
    expect(await screen.findByText('Template próprio do curso')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('copia a palavra-chave', async () => {
    const user = userEvent.setup();
    open();
    const keys = await screen.findByRole('list', { name: 'Palavras-chave' });
    await user.click(within(keys).getByRole('button', { name: 'Copiar {{aluno.nome}}' }));
    expect(await navigator.clipboard.readText()).toBe('{{aluno.nome}}');
    expect(await screen.findByText('{{aluno.nome}} copiada.')).toBeTruthy();
  });

  it('template próprio: salvar envia a versão aberta; editar não avisa emissão', async () => {
    const user = userEvent.setup();
    const { bodies } = open({ [`GET ${TEMPLATE_URL}`]: OWN });
    const box = await editor();
    expect(box.value).toBe(OWN.html);
    expect(screen.getByText(/Salvo por Ivo Instrutor/)).toBeTruthy();
    expect((button('Salvar template') as HTMLButtonElement).disabled).toBe(true);
    await user.type(box, ' ');
    await user.click(button('Salvar template'));
    expect(await screen.findByText('Template do certificado salvo.')).toBeTruthy();
    expect(bodies).toEqual([{ html: `${OWN.html} `, expectedVersionId: VERSION }]);
    expect(screen.queryByText('Os alunos que já concluíram vão receber o certificado.')).toBeNull();
  });

  it('modelo sobre um texto já escrito pede confirmação', async () => {
    const user = userEvent.setup();
    open({ [`GET ${TEMPLATE_URL}`]: OWN });
    const box = await editor();
    await waitFor(() =>
      expect((button('Começar do modelo') as HTMLButtonElement).disabled).toBe(false),
    );
    await user.click(button('Começar do modelo'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Trocar pelo modelo?' });
    await user.click(within(dialog).getByRole('button', { name: 'Usar o modelo' }));
    expect(box.value).toBe(MODEL);
  });

  it('422 mostra cada problema com a linha e leva o cursor a ela', async () => {
    const user = userEvent.setup();
    open({
      [`PUT ${TEMPLATE_URL}`]: problem(422, 'certificate_template_invalid', {
        details: {
          problems: [
            {
              rule: 'element_not_allowed',
              message: '<script> não é permitido',
              line: 3,
              column: 4,
            },
            {
              rule: 'missing_required_key',
              message: 'falta {{certificado.codigo}}',
              line: 1,
              column: 1,
            },
          ],
        },
      }),
    });
    const box = await editor();
    await user.type(box, '<p>a</p>{enter}<p>b</p>{enter}<p><script></script></p>');
    await user.click(button('Salvar template'));

    const list = await screen.findByText('O template tem 2 problemas');
    const alert = list.closest('[role="alert"]') as HTMLElement;
    expect(
      within(alert).getByText(/Elemento não permitido — <script> não é permitido/),
    ).toBeTruthy();
    // o cursor está no primeiro problema: linha 3, coluna 4
    const lineThree = box.value.indexOf('<p><script>');
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.selectionStart).toBe(lineThree + 3);
    expect(box.getAttribute('aria-invalid')).toBe('true');

    await user.click(within(alert).getByRole('button', { name: 'Linha 1, coluna 1' }));
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(0);
    await expectNoAxeViolations();
  });

  it('com 200 problemas avisa que pode haver outros', async () => {
    const user = userEvent.setup();
    const problems = Array.from({ length: 200 }, (_, index) => ({
      rule: 'unknown_key',
      message: `chave ${index}`,
      line: 1,
      column: 1,
    }));
    open({
      [`PUT ${TEMPLATE_URL}`]: problem(422, 'certificate_template_invalid', {
        details: { problems },
      }),
    });
    await user.type(await editor(), 'x');
    await user.click(button('Salvar template'));
    expect(await screen.findByText(/pode haver outros/)).toBeTruthy();
  });

  it('409 oferece recarregar e traz a versão atual', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const { fetchMock } = open({
      [`GET ${TEMPLATE_URL}`]: () => {
        reads += 1;
        return reads === 1 ? OWN : { ...OWN, html: '<p>de outra pessoa</p>', versionId: VERSION_2 };
      },
      [`PUT ${TEMPLATE_URL}`]: problem(409, 'version_conflict'),
    });
    const box = await editor();
    await user.type(box, ' meu');
    await user.click(button('Salvar template'));
    expect(await screen.findByText('O template foi salvo por outra pessoa')).toBeTruthy();
    await user.click(button('Recarregar'));
    await waitFor(() => expect(box.value).toBe('<p>de outra pessoa</p>'));
    expect(screen.queryByText('O template foi salvo por outra pessoa')).toBeNull();
    expect(calls(fetchMock).filter((call) => call === `GET ${TEMPLATE_URL}`)).toHaveLength(2);
  });

  it('gera o PDF de exemplo, consulta o estado e o abre numa aba nova', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    let reads = 0;
    open({
      [`GET ${TEMPLATE_URL}`]: OWN,
      'POST /api/v1/certificate-templates/previews': async (request: Request) => {
        bodies.push(await request.json());
        return new Response(JSON.stringify(preview('pending')), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      [`GET /api/v1/certificate-templates/previews/${PREVIEW_ID}`]: () => {
        reads += 1;
        return reads === 1 ? preview('pending') : preview('ready');
      },
    });
    await editor();
    await user.click(button('Gerar PDF de exemplo'));
    expect(await screen.findByText('Gerando o PDF de exemplo…')).toBeTruthy();
    expect(bodies).toEqual([{ html: OWN.html, courseId: COURSE_ID }]);

    const pdf = `/api/v1/certificate-templates/previews/${PREVIEW_ID}/pdf`;
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(pdf, '_blank', 'noopener'), {
      timeout: 4000,
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    const link = await screen.findByRole('link', { name: /Abrir o PDF de exemplo/ });
    expect(link.getAttribute('href')).toBe(pdf);
    expect(link.getAttribute('target')).toBe('_blank');
    await expectNoAxeViolations();
  });

  it('exemplo que falhou mostra o motivo', async () => {
    const user = userEvent.setup();
    open({
      [`GET ${TEMPLATE_URL}`]: OWN,
      'POST /api/v1/certificate-templates/previews': preview('pending'),
      [`GET /api/v1/certificate-templates/previews/${PREVIEW_ID}`]: preview(
        'failed',
        'tempo esgotado',
      ),
    });
    await editor();
    await user.click(button('Gerar PDF de exemplo'));
    expect(await screen.findByText('tempo esgotado')).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('429 no exemplo mostra a espera', async () => {
    const user = userEvent.setup();
    open({
      [`GET ${TEMPLATE_URL}`]: OWN,
      'POST /api/v1/certificate-templates/previews': problem(
        429,
        'rate_limited',
        {},
        {
          'Retry-After': '120',
        },
      ),
    });
    await editor();
    await user.click(button('Gerar PDF de exemplo'));
    expect(
      await screen.findByText(/Muitas requisições seguidas\. Tente de novo em 2 minutos\./),
    ).toBeTruthy();
  });

  it('insere uma imagem local como data: no cursor; recusa tipo e tamanho', async () => {
    const user = userEvent.setup({ applyAccept: false });
    open();
    const box = await editor();
    const input = screen.getByTestId('template-image-input') as HTMLInputElement;

    await user.upload(input, new File(['GIF89a'], 'selo.gif', { type: 'image/gif' }));
    await waitFor(() =>
      expect(box.value).toMatch(/^<img src="data:image\/gif;base64,[^"]+" alt="">$/),
    );

    await user.upload(input, new File(['<svg/>'], 'selo.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText('Use uma imagem PNG, JPEG, WebP ou GIF.')).toBeTruthy();

    const big = new File([new Uint8Array(700 * 1024)], 'fundo.png', { type: 'image/png' });
    const before = box.value;
    await user.upload(input, big);
    expect(await screen.findByText(/acima do limite de 768 KiB/)).toBeTruthy();
    expect(box.value).toBe(before);
  });

  it('exclui com confirmação; o curso volta ao padrão da escola', async () => {
    const user = userEvent.setup();
    const { fetchMock } = open({
      [`GET ${TEMPLATE_URL}`]: OWN,
      [`DELETE ${TEMPLATE_URL}`]: { ...NONE, source: 'school' },
    });
    await editor();
    await user.click(button('Excluir template'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Excluir o template?' });
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Template do certificado excluído.')).toBeTruthy();
    expect(await screen.findByText('Template padrão da escola')).toBeTruthy();
    expect((await editor()).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Excluir template' })).toBeNull();
    expect(calls(fetchMock)).toContain(`DELETE ${TEMPLATE_URL}`);
  });
});

describe('quem vê a aba do template', () => {
  const tab = () => screen.queryByRole('tab', { name: 'Template do certificado' });

  it('instrutor vê no próprio curso', async () => {
    open({}, 'instructor', courseDetail({ owner: { id: ADMIN_ID, name: 'Ivo Instrutor' } }));
    await editor();
    expect(tab()).toBeTruthy();
  });

  it('instrutor não vê em curso de outro dono; o endereço cai nos dados', async () => {
    const { fetchMock } = open({}, 'instructor', courseDetail());
    expect(await screen.findByRole('tab', { name: 'Dados' })).toBeTruthy();
    expect(tab()).toBeNull();
    expect(calls(fetchMock)).not.toContain(`GET ${TEMPLATE_URL}`);
  });

  it('gerente vê em qualquer curso', async () => {
    open({}, 'manager');
    await editor();
    expect(tab()).toBeTruthy();
  });
});

describe('template padrão da escola (/configuracoes)', () => {
  const SCHOOL_URL = '/api/v1/settings/certificate-template';
  const settings = {
    'GET /api/v1/settings/certificates': {
      signerName: null,
      signerRole: null,
      schoolName: 'Escola Aurora',
    },
    'GET /api/v1/certificate-templates/reference': REFERENCE,
  };

  it('o admin edita o padrão; salvar não manda curso e o exemplo também não', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    renderApp('/configuracoes', {
      ...defaultRoutes('admin'),
      ...settings,
      [`GET ${SCHOOL_URL}`]: NONE,
      [`PUT ${SCHOOL_URL}`]: async (request: Request) => {
        const body = (await request.json()) as { html: string };
        bodies.push(body);
        return { ...OWN, source: 'school', html: body.html, backfillQueued: true };
      },
      'POST /api/v1/certificate-templates/previews': async (request: Request) => {
        bodies.push(await request.json());
        return preview('ready');
      },
      [`GET /api/v1/certificate-templates/previews/${PREVIEW_ID}`]: preview('ready'),
    });
    expect(
      await screen.findByRole('heading', { name: 'Template padrão do certificado' }),
    ).toBeTruthy();
    const box = await editor();
    expect(screen.getByText(/Não há template padrão/)).toBeTruthy();
    await user.type(box, '<p>x</p>');
    await user.click(button('Gerar PDF de exemplo'));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    await user.click(button('Salvar template'));
    expect(
      await screen.findByText('Os alunos que já concluíram vão receber o certificado.'),
    ).toBeTruthy();
    expect(bodies).toEqual([{ html: '<p>x</p>' }, { html: '<p>x</p>', expectedVersionId: null }]);
    await expectNoAxeViolations();
  });

  it('o gerente não abre as configurações nem lê o padrão', async () => {
    const { fetchMock } = renderApp('/configuracoes', {
      ...defaultRoutes('manager'),
      ...settings,
      [`GET ${SCHOOL_URL}`]: NONE,
    });
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
    expect(calls(fetchMock)).not.toContain(`GET ${SCHOOL_URL}`);
  });
});
