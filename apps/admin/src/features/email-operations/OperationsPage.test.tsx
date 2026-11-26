import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { calls, defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  EMAIL_ID,
  JOB_ID,
  opsEmail,
  opsJob,
  opsSummary,
  schoolBranding,
} from '../../test/operations';
import { webhookEvent } from '../../test/payments';
import { findMenu, jsonResponse, renderApp } from '../../test/render';

const REJECTED = webhookEvent({
  id: '0193a5b2-0000-7000-8000-0000000000e2',
  eventId: null,
  resourceType: null,
  resourceId: null,
  status: 'rejected',
  attempts: 0,
  error: 'invalid_signature',
});

function section(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name, level: 2 });
  return heading.closest('section') as HTMLElement;
}

async function findSection(name: string): Promise<HTMLElement> {
  await screen.findByRole('heading', { name, level: 2 });
  return section(name);
}

function operationsRoutes(extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  let jobStatus = 'failed';
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/ops/summary': opsSummary(),
    'GET /api/v1/ops/jobs': (request: Request) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      jobStatus = params.get('status') ?? 'failed';
      return { items: [opsJob()], nextCursor: null };
    },
    'GET /api/v1/ops/emails': (request: Request) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return { items: [opsEmail()], nextCursor: null };
    },
    'GET /api/v1/webhook-events': (request: Request) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return params.get('status') === 'rejected'
        ? { items: [REJECTED], nextCursor: null }
        : { items: [webhookEvent()], nextCursor: null };
    },
    ...extra,
  };
  return { routes, queries, jobStatus: () => jobStatus };
}

describe('operação (/operacao)', () => {
  it('mostra resumo, fila, e-mails, webhooks e sistema, sem violações do axe', async () => {
    const { routes, queries } = operationsRoutes();
    renderApp('/operacao', routes);

    expect(await screen.findByRole('heading', { name: 'Operação', level: 1 })).toBeTruthy();
    const summary = section('Resumo');
    expect(await within(summary).findByText('Falhas')).toBeTruthy();
    expect(within(summary).getByText('6')).toBeTruthy();
    expect(within(summary).getByText('Na fila')).toBeTruthy();
    expect(within(summary).getByText('Em execução')).toBeTruthy();
    expect(within(summary).getByText('E-mails pendentes')).toBeTruthy();

    const jobs = section('Fila de tarefas');
    expect(await within(jobs).findByText('email.send')).toBeTruthy();
    expect(within(jobs).getByText('3 de 3')).toBeTruthy();
    expect(within(jobs).getByText('smtp_timeout')).toBeTruthy();
    expect(within(jobs).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    expect(within(jobs).getByRole('button', { name: 'Descartar' })).toBeTruthy();

    const emails = section('E-mails');
    expect(await within(emails).findByText('ticket.reply')).toBeTruthy();
    expect(within(emails).getByText('a***@exemplo.com')).toBeTruthy();
    expect(within(emails).getByText('Ainda sem assunto')).toBeTruthy();
    expect(within(emails).getByRole('button', { name: 'Reenviar' })).toBeTruthy();

    const webhooks = section('Webhooks de pagamento');
    expect(await within(webhooks).findByText('evt-1')).toBeTruthy();
    expect(within(webhooks).getByRole('button', { name: 'Reprocessar' })).toBeTruthy();

    const system = section('Sistema');
    expect(within(system).getByText('0.1.0')).toBeTruthy();
    expect(within(system).getByText('0019')).toBeTruthy();
    expect(within(system).getByText('15 MB')).toBeTruthy();
    expect(within(system).getByText('2 MB')).toBeTruthy();

    const menu = await findMenu();
    expect(within(menu).getByText('6')).toBeTruthy();

    expect(queries.some((params) => params.get('status') === 'failed')).toBe(true);
    await expectNoAxeViolations();
  });

  it('tenta a tarefa de novo e recarrega a fila', async () => {
    const user = userEvent.setup();
    let retried = false;
    const { routes, jobStatus } = operationsRoutes({
      [`POST /api/v1/ops/jobs/${JOB_ID}/retry`]: () => {
        retried = true;
        return jsonResponse(opsJob({ status: 'queued' }), 202);
      },
    });
    renderApp('/operacao', routes);
    const jobs = await findSection('Fila de tarefas');
    await within(jobs).findByRole('button', { name: 'Tentar de novo' });

    await user.click(within(jobs).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(retried).toBe(true));
    expect(await screen.findByText('Tarefa email.send voltou para a fila.')).toBeTruthy();
    expect(jobStatus()).toBe('failed');
  });

  it('descarta a tarefa com confirmação', async () => {
    const user = userEvent.setup();
    let discarded = false;
    const { routes } = operationsRoutes({
      [`DELETE /api/v1/ops/jobs/${JOB_ID}`]: () => {
        discarded = true;
        return new Response(null, { status: 204 });
      },
    });
    const { fetchMock } = renderApp('/operacao', routes);
    const jobs = await findSection('Fila de tarefas');
    await within(jobs).findByRole('button', { name: 'Descartar' });

    await user.click(within(jobs).getByRole('button', { name: 'Descartar' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Descartar tarefa')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Descartar' }));

    await waitFor(() => expect(discarded).toBe(true));
    expect(await screen.findByText('Tarefa email.send descartada.')).toBeTruthy();
    expect(calls(fetchMock)).toContain(`DELETE /api/v1/ops/jobs/${JOB_ID}`);
  });

  it('reenvia um e-mail com falha mantendo o destinatário mascarado', async () => {
    const user = userEvent.setup();
    let retried = false;
    const { routes } = operationsRoutes({
      [`POST /api/v1/ops/emails/${EMAIL_ID}/retry`]: () => {
        retried = true;
        return jsonResponse(opsEmail({ status: 'queued' }), 202);
      },
    });
    renderApp('/operacao', routes);
    const emails = await findSection('E-mails');
    await within(emails).findByRole('button', { name: 'Reenviar' });

    await user.click(within(emails).getByRole('button', { name: 'Reenviar' }));
    await waitFor(() => expect(retried).toBe(true));
    expect(await screen.findByText('E-mail devolvido à fila.')).toBeTruthy();
    expect(screen.getByText('a***@exemplo.com')).toBeTruthy();
    expect(screen.queryByText('aluno@exemplo.com')).toBeNull();
  });

  it('mostra o motivo de cada recusa da API', async () => {
    const user = userEvent.setup();
    const { routes } = operationsRoutes({
      [`POST /api/v1/ops/jobs/${JOB_ID}/retry`]: problem(409, 'job_not_failed'),
      [`POST /api/v1/ops/emails/${EMAIL_ID}/retry`]: problem(409, 'email_not_failed'),
    });
    renderApp('/operacao', routes);
    const jobs = await findSection('Fila de tarefas');
    await within(jobs).findByRole('button', { name: 'Tentar de novo' });

    await user.click(within(jobs).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Esta tarefa não está com falha.')).toBeTruthy();

    await within(section('E-mails')).findByRole('button', { name: 'Reenviar' });
    await user.click(within(section('E-mails')).getByRole('button', { name: 'Reenviar' }));
    expect(await screen.findByText('Este e-mail não está com falha.')).toBeTruthy();
  });

  it('reprocessa um webhook com falha e não oferece ação na trilha de recusados', async () => {
    const user = userEvent.setup();
    let retried = false;
    const { routes, queries } = operationsRoutes({
      [`POST /api/v1/webhook-events/${webhookEvent().id}/retry`]: () => {
        retried = true;
        return webhookEvent({ status: 'received', attempts: 0 });
      },
    });
    renderApp('/operacao', routes);
    const webhooks = await screen.findByRole('heading', {
      name: 'Webhooks de pagamento',
      level: 2,
    });
    const webhookSection = webhooks.closest('section') as HTMLElement;
    await within(webhookSection).findByRole('button', { name: 'Reprocessar' });

    await user.click(within(webhookSection).getByRole('button', { name: 'Reprocessar' }));
    await waitFor(() => expect(retried).toBe(true));
    expect(await screen.findByText('Aviso enfileirado de novo.')).toBeTruthy();

    await user.click(within(webhookSection).getByRole('tab', { name: 'Recusados' }));
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('rejected'));
    expect(await within(webhookSection).findByText('invalid_signature')).toBeTruthy();
    expect(within(webhookSection).queryByRole('button', { name: 'Reprocessar' })).toBeNull();
    expect(within(webhookSection).queryByText('Tentativas')).toBeNull();
  });

  it('esconde a operação do gerente e recusa o endereço aberto à força', async () => {
    renderApp('/operacao', defaultRoutes('manager'));
    const menu = await findMenu();
    expect(within(menu).queryByRole('link', { name: 'Operação' })).toBeNull();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });
});

const NEW_LOGO_ID = '0193a5b2-0000-7000-8000-0000000000d4';

/** Resposta de `POST /api/v1/images` com a finalidade `school_logo` (spec 029). */
function schoolLogo(id = NEW_LOGO_ID) {
  return {
    id,
    purpose: 'school_logo',
    width: 1024,
    height: 512,
    variants: [
      { width: 64, height: 32, url: `/api/v1/images/${id}/64.webp` },
      { width: 256, height: 128, url: `/api/v1/images/${id}/256.webp` },
      { width: 512, height: 256, url: `/api/v1/images/${id}/512.webp` },
    ],
  };
}

/** Recusas do envio do logotipo (spec 029) e o texto que a seção mostra. */
const LOGO_REFUSALS = [
  { status: 413, code: 'payload_too_large', text: 'A imagem passa de 5 MB.' },
  { status: 415, code: 'image_type_unsupported', text: 'Use uma imagem JPEG, PNG ou WebP.' },
  {
    status: 422,
    code: 'image_dimensions_exceeded',
    text: 'A imagem é grande demais: até 8.000 px de lado e 40 megapixels.',
  },
  {
    status: 422,
    code: 'image_too_heavy',
    text: 'A imagem ficou pesada demais depois de processada. Envie uma mais simples ou menor.',
  },
  {
    status: 429,
    code: 'rate_limited',
    text: /Muitas requisições seguidas/,
  },
  {
    status: 503,
    code: 'image_processing_busy',
    text: 'O processamento de imagens está ocupado. Tente de novo em instantes.',
  },
] as const;

function logoFile() {
  return new File(['logo'], 'logo.png', { type: 'image/png' });
}

describe('identidade da escola nos e-mails', () => {
  it('mostra e grava nome, cor, logotipo e rodapé, sem violações do axe', async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'PUT /api/v1/settings/branding': async (request: Request) => {
        saved = await request.json();
        return schoolBranding({ schoolName: 'Escola Nova', footer: 'Até logo!' });
      },
    };
    renderApp('/configuracoes', routes);

    expect(await screen.findByRole('heading', { name: 'E-mail', level: 2 })).toBeTruthy();
    expect(await screen.findByDisplayValue('Escola Aurora')).toBeTruthy();
    expect(screen.getByAltText('Logotipo de Escola Aurora')).toBeTruthy();
    expect(
      screen.getByText('JPEG, PNG ou WebP, até 5 MB. Proporção original, sem corte.'),
    ).toBeTruthy();
    await expectNoAxeViolations();

    await user.clear(screen.getByDisplayValue('Escola Aurora'));
    await user.type(screen.getByLabelText('Nome da escola'), 'Escola Nova');
    await user.type(screen.getByLabelText('Cor de destaque'), '#1F6FEB');
    await user.type(screen.getByLabelText('Rodapé'), 'Até logo!');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(saved).toEqual({
        schoolName: 'Escola Nova',
        logoImageId: '0193a5b2-0000-7000-8000-0000000000d3',
        accentColor: '#1F6FEB',
        footer: 'Até logo!',
      }),
    );
    expect(await screen.findByText('Identidade da escola salva.')).toBeTruthy();
  });

  it('marca o campo recusado pela API', async () => {
    const user = userEvent.setup();
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'PUT /api/v1/settings/branding': problem(400, 'validation_failed', {
        errors: [{ path: 'body.accentColor', code: 'invalid', message: 'cor inválida' }],
      }),
    };
    renderApp('/configuracoes', routes);
    await screen.findByDisplayValue('Escola Aurora');

    await user.type(screen.getByLabelText('Cor de destaque'), '#zzz');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Valor fora do formato aceito.')).toBeTruthy();
  });

  it('envia o logotipo, mostra a variante de 256 e grava o identificador, sem violações do axe', async () => {
    const user = userEvent.setup();
    let purpose: FormDataEntryValue | null = null;
    let saved: unknown = null;
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'POST /api/v1/images': async (request: Request) => {
        purpose = /name="purpose"\r\n\r\n([^\r\n]+)/.exec(await request.text())?.[1] ?? null;
        return schoolLogo();
      },
      'PUT /api/v1/settings/branding': async (request: Request) => {
        saved = await request.json();
        return schoolBranding({ logoUrl: `/api/v1/images/${NEW_LOGO_ID}/256.webp` });
      },
    };
    renderApp('/configuracoes', routes);
    await screen.findByDisplayValue('Escola Aurora');

    await user.upload(screen.getByTestId('image-picker-input'), logoFile());
    await waitFor(() => expect(purpose).toBe('school_logo'));
    // a prévia local (`blob:`) sai e fica a variante de 256 devolvida pelo envio
    const logo = () => screen.getByRole('img', { name: 'Logotipo de Escola Aurora' });
    await waitFor(() =>
      expect(logo().getAttribute('src')).toBe(`/api/v1/images/${NEW_LOGO_ID}/256.webp`),
    );
    expect(
      await screen.findByText('Logotipo enviado. Clique em Salvar para aplicar.'),
    ).toBeTruthy();
    await expectNoAxeViolations();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(saved).toEqual({
        schoolName: 'Escola Aurora',
        logoImageId: NEW_LOGO_ID,
        accentColor: null,
        footer: null,
      }),
    );
    expect(await screen.findByText('Identidade da escola salva.')).toBeTruthy();
    // a prévia continua a do logotipo gravado, sem recarregar a página
    expect(logo().getAttribute('src')).toBe(`/api/v1/images/${NEW_LOGO_ID}/256.webp`);
  });

  it('remove o logotipo e grava logoImageId nulo', async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'PUT /api/v1/settings/branding': async (request: Request) => {
        saved = await request.json();
        return schoolBranding({ logoUrl: null });
      },
    };
    renderApp('/configuracoes', routes);
    await screen.findByDisplayValue('Escola Aurora');
    expect(screen.getByAltText('Logotipo de Escola Aurora')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remover logotipo' }));
    expect(screen.getByText('Sem logotipo')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(saved).toEqual({
        schoolName: 'Escola Aurora',
        logoImageId: null,
        accentColor: null,
        footer: null,
      }),
    );
    expect(await screen.findByText('Identidade da escola salva.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Logotipo de Escola Aurora' })).toBeNull();
  });

  it.each(LOGO_REFUSALS)('mostra a recusa $code no envio do logotipo', async (refusal) => {
    const user = userEvent.setup();
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'POST /api/v1/images': problem(refusal.status, refusal.code),
    };
    renderApp('/configuracoes', routes);
    await screen.findByDisplayValue('Escola Aurora');

    await user.upload(screen.getByTestId('image-picker-input'), logoFile());
    expect(await screen.findByText(refusal.text)).toBeTruthy();
  });

  it('uma recusa no envio não perde os outros campos do formulário', async () => {
    const user = userEvent.setup();
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'POST /api/v1/images': problem(413, 'payload_too_large'),
    };
    renderApp('/configuracoes', routes);
    await screen.findByDisplayValue('Escola Aurora');

    await user.clear(screen.getByDisplayValue('Escola Aurora'));
    await user.type(screen.getByLabelText('Nome da escola'), 'Escola Nova');
    await user.type(screen.getByLabelText('Rodapé'), 'Até logo!');
    await user.upload(screen.getByTestId('image-picker-input'), logoFile());

    expect(await screen.findByText('A imagem passa de 5 MB.')).toBeTruthy();
    expect(screen.getByDisplayValue('Escola Nova')).toBeTruthy();
    expect(screen.getByDisplayValue('Até logo!')).toBeTruthy();
  });

  it('mostra na seção a recusa de finalidade ao gravar a identidade', async () => {
    const user = userEvent.setup();
    const routes: Routes = {
      ...defaultRoutes(),
      'GET /api/v1/settings/branding': schoolBranding(),
      'PUT /api/v1/settings/branding': problem(422, 'image_purpose_mismatch'),
    };
    renderApp('/configuracoes', routes);
    await screen.findByDisplayValue('Escola Aurora');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      await screen.findByText(
        'Esta imagem não serve como logotipo. Envie outra ou remova o logotipo.',
      ),
    ).toBeTruthy();
    // a recusa é da imagem, não dos outros campos
    expect(screen.queryByText('Valor fora do formato aceito.')).toBeNull();

    // removendo a imagem recusada, o aviso sai junto
    await user.click(screen.getByRole('button', { name: 'Remover logotipo' }));
    expect(
      screen.queryByText('Esta imagem não serve como logotipo. Envie outra ou remova o logotipo.'),
    ).toBeNull();
  });
});
