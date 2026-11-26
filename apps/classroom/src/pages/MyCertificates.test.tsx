import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { CERTIFICATE_ID, MY_CERTIFICATES, pdfResponse } from '../test/certificates';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';
import { ACTIVITY, MY_PROGRESS } from '../test/shelf';

const t = ptBR.certificates;
const CERTIFICATES = 'GET /api/v1/me/certificates';
const PDF = `GET /api/v1/me/certificates/${CERTIFICATE_ID}/pdf`;
const NAME = 'PUT /api/v1/me/certificate-name';
const session = makeSession();
const routes = (handlers: Record<string, (request: Request) => Response | Promise<Response>>) =>
  apiRoutes({
    'GET /api/v1/me/progress': () => jsonResponse(MY_PROGRESS),
    'GET /api/v1/me/activity': () => jsonResponse(ACTIVITY),
    [CERTIFICATES]: () => jsonResponse(MY_CERTIFICATES),
    ...handlers,
  });
const section = async () =>
  (await screen.findByRole('heading', { level: 2, name: t.section.title })).closest(
    'section',
  ) as HTMLElement;
const certificate = async (title: string) =>
  within(
    within(await screen.findByRole('list', { name: t.section.list })).getByRole('article', {
      name: title,
    }),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/progresso: Certificados', () => {
  it('lista os certificados com o estado, os cursos que aguardam template e o nome', async () => {
    renderApp('/progresso#certificados', routes({}), { session });

    const box = within(await section());
    expect(await box.findByText('Ana Souza Lima')).toBeTruthy();
    expect(box.getByText(t.name.next)).toBeTruthy();

    // emitido: dados congelados, download e a página de validação
    const react = await certificate('React do zero');
    expect(react.getByText(t.badge.issued)).toBeTruthy();
    expect(react.getByText('12 horas')).toBeTruthy();
    expect(react.getByText('Concluído em 20 de novembro de 2026')).toBeTruthy();
    expect(react.getByText('Código: ABCD-EFGH-JKMN')).toBeTruthy();
    expect(react.getByRole('button', { name: 'Baixar certificado: React do zero' })).toBeTruthy();
    expect(
      react.getByRole('link', { name: 'Página de validação: React do zero' }).getAttribute('href'),
    ).toBe('/certificados/ABCD-EFGH-JKMN');

    // em preparação e revogado: sem download
    const node = await certificate('Node na prática');
    expect(node.getByText(t.badge.preparing)).toBeTruthy();
    expect(node.getByText('1 hora')).toBeTruthy();
    expect(node.queryByRole('button')).toBeNull();
    const git = await certificate('Git essencial');
    expect(git.getByText(t.badge.revoked)).toBeTruthy();
    expect(git.getByText('Revogado em 22 de novembro de 2026')).toBeTruthy();
    expect(git.queryByRole('button')).toBeNull();
    expect(git.queryByRole('link', { name: /validação/ })).toBeNull();

    // concluído sem template: o aviso e nenhum botão de download
    expect(box.getByText(t.state.awaiting_template)).toBeTruthy();
    const awaiting = within(box.getByRole('list', { name: t.section.awaitingList }));
    const css = within(awaiting.getByRole('article', { name: 'CSS moderno' }));
    expect(css.getByText('Concluído em 10 de novembro de 2026')).toBeTruthy();
    expect(css.queryByRole('button')).toBeNull();

    expect(document.getElementById('certificados')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('sem certificados, diz o que fazer para ganhar um', async () => {
    renderApp(
      '/progresso',
      routes({
        [CERTIFICATES]: () =>
          jsonResponse({ studentName: 'Ana Souza', items: [], awaitingTemplate: [] }),
      }),
      { session },
    );
    const box = within(await section());
    expect(await box.findByText(t.section.emptyTitle)).toBeTruthy();
    expect(box.getByText(t.section.emptyText)).toBeTruthy();
    expect(box.queryByRole('list', { name: t.section.list })).toBeNull();
  });

  it('baixa o PDF pela API e o entrega com o nome do código', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(browser, 'saveFile').mockImplementation(() => {});
    const { calls } = renderApp('/progresso', routes({ [PDF]: () => pdfResponse() }), {
      session,
    });

    const react = await certificate('React do zero');
    await user.click(react.getByRole('button', { name: 'Baixar certificado: React do zero' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [file, name] = save.mock.calls[0] ?? [];
    expect(name).toBe('certificado-ABCD-EFGH-JKMN.pdf');
    expect(await (file as Blob).text()).toBe('%PDF-1.7 certificado');
    expect(calls.filter((call) => call.path.endsWith('/pdf'))).toHaveLength(1);
  });

  it('PDF ainda não gerado avisa "em preparação" e consulta os estados de novo', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(browser, 'saveFile').mockImplementation(() => {});
    const { calls } = renderApp(
      '/progresso',
      routes({ [PDF]: () => problemResponse(409, 'certificate_preparing') }),
      { session },
    );

    const react = await certificate('React do zero');
    const listed = () => calls.filter((call) => call.path === '/api/v1/me/certificates').length;
    const before = listed();
    await user.click(react.getByRole('button', { name: 'Baixar certificado: React do zero' }));

    expect(await screen.findByText(t.download.preparing)).toBeTruthy();
    await waitFor(() => expect(listed()).toBe(before + 1));
    expect(save).not.toHaveBeenCalled();
  });

  it('outra falha do download avisa com o código da requisição', async () => {
    const user = userEvent.setup();
    renderApp(
      '/progresso',
      routes({
        [PDF]: () => problemResponse(404, 'not_found'),
      }),
      { session },
    );
    const react = await certificate('React do zero');
    await user.click(react.getByRole('button', { name: 'Baixar certificado: React do zero' }));
    const alert = await findAlert();
    expect(within(alert).getByText(t.download.errorTitle)).toBeTruthy();
    expect(alert.textContent).toContain(ptBR.errors.notAvailable);
    expect(alert.textContent).toContain('req-teste-1');
  });

  it('"Alterar" grava o nome do certificado; vazio volta ao nome de exibição', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const { calls } = renderApp(
      '/progresso',
      routes({
        [NAME]: async (request) => {
          const body = (await request.json()) as { fullName: string | null };
          bodies.push(body);
          return jsonResponse({
            fullName: body.fullName,
            studentName: body.fullName ?? 'Ana Souza',
          });
        },
      }),
      { session },
    );

    const box = within(await section());
    await box.findByText('Ana Souza Lima');
    await user.click(box.getByRole('button', { name: t.name.changeLabel }));
    const dialog = within(await screen.findByRole('dialog', { name: t.name.dialogTitle }));
    const field = dialog.getByRole('textbox', { name: t.name.field }) as HTMLInputElement;
    expect(field.value).toBe('Ana Souza Lima');
    expect(field.maxLength).toBe(160);
    await expectNoAxeViolations();

    await user.clear(field);
    await user.type(field, '  Ana Souza Lima Neto ');
    await user.click(dialog.getByRole('button', { name: t.name.save }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await box.findByText('Ana Souza Lima Neto')).toBeTruthy();
    expect(screen.getByText(t.name.saved)).toBeTruthy();
    expect(bodies).toEqual([{ fullName: 'Ana Souza Lima Neto' }]);
    expect(calls.find((call) => call.method === 'PUT')?.csrf).toBe(session.csrfToken);

    await user.click(box.getByRole('button', { name: t.name.changeLabel }));
    const again = within(await screen.findByRole('dialog', { name: t.name.dialogTitle }));
    await user.clear(again.getByRole('textbox', { name: t.name.field }));
    await user.click(again.getByRole('button', { name: t.name.save }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ fullName: null });
    expect(await box.findByText('Ana Souza')).toBeTruthy();
  });

  it('nome recusado mostra o erro no campo e mantém o diálogo aberto', async () => {
    const user = userEvent.setup();
    renderApp(
      '/progresso',
      routes({
        [NAME]: () =>
          problemResponse(400, 'validation_failed', {
            errors: [{ path: 'body.fullName', message: 'muito longo' }],
          }),
      }),
      { session },
    );
    const box = within(await section());
    await box.findByText('Ana Souza Lima');
    await user.click(box.getByRole('button', { name: t.name.changeLabel }));
    const dialog = within(await screen.findByRole('dialog', { name: t.name.dialogTitle }));
    await user.click(dialog.getByRole('button', { name: t.name.save }));
    expect(await dialog.findByText('Use no máximo 160 caracteres.')).toBeTruthy();
    expect(dialog.getByRole('textbox', { name: t.name.field }).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
});
