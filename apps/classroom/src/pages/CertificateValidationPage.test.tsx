import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { normalizeCode, validationPath } from '../certificates/certificates';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  CERTIFICATE_CODE,
  REMOVED_VERIFICATION,
  REVOKED_VERIFICATION,
  VALID_VERIFICATION,
} from '../test/certificates';
import {
  apiRoutes,
  inMain,
  jsonResponse,
  missingRouteResponse,
  problemResponse,
  renderApp,
} from '../test/renderApp';

const t = ptBR.certificates.verify;
const VERIFY = `GET /api/v1/certificates/verify/${CERTIFICATE_CODE}`;
const result = () => screen.findByRole('article', { name: /./ });
const facts = (article: HTMLElement) =>
  Object.fromEntries(
    within(article)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );

describe('normalizeCode', () => {
  it('põe o código no formato impresso, sem espaços e em maiúsculas', () => {
    expect(normalizeCode(' abcd efgh jkmn ')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeCode('abcd-efgh-jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    // fora do formato vai como está (a API responde "não encontrado")
    expect(normalizeCode('abc')).toBe('ABC');
    expect(normalizeCode('   ')).toBe('');
    expect(validationPath('A/B')).toBe('/certificados/A%2FB');
  });
});

describe('validação pública de certificado', () => {
  it('sem login, mostra os dados do certificado válido, sem e-mail, foto nem perfil', async () => {
    const { requests } = renderApp(
      `/certificados/${CERTIFICATE_CODE}`,
      apiRoutes({ [VERIFY]: () => jsonResponse(VALID_VERIFICATION) }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.pages.certificates }),
    ).toBeTruthy();
    const article = await result();
    expect(within(article).getByRole('heading', { level: 2, name: t.validTitle })).toBeTruthy();
    expect(facts(article)).toEqual({
      [t.fields.student]: 'Ana Souza Lima',
      [t.fields.course]: 'React do zero',
      [t.fields.hours]: '12 horas',
      [t.fields.completedAt]: '20 de novembro de 2026',
      [t.fields.issuedAt]: '20 de novembro de 2026',
      [t.fields.school]: 'Escola Aurora',
      [t.fields.code]: CERTIFICATE_CODE,
    });
    // nada de foto, de link (perfil ou PDF) nem de e-mail no resultado
    expect(within(article).queryAllByRole('img')).toHaveLength(0);
    expect(within(article).queryAllByRole('link')).toHaveLength(0);
    expect(article.textContent).not.toMatch(/@/);
    // a página não pede sessão para nada além da casca
    expect(requests).not.toContain('/api/v1/me/certificates');
    expect((screen.getByRole('textbox', { name: t.field }) as HTMLInputElement).value).toBe(
      CERTIFICATE_CODE,
    );

    await waitFor(() => expect(document.title).toBe(`${ptBR.pages.certificates} · Escola Aurora`));
    await expectNoAxeViolations();
  });

  it('aceita o código em minúsculas e sem hífens', async () => {
    const { calls } = renderApp(
      '/certificados/abcdefghjkmn',
      apiRoutes({ [VERIFY]: () => jsonResponse(VALID_VERIFICATION) }),
    );
    expect(await screen.findByRole('heading', { level: 2, name: t.validTitle })).toBeTruthy();
    expect(
      calls.some((call) => call.path === `/api/v1/certificates/verify/${CERTIFICATE_CODE}`),
    ).toBe(true);
  });

  it('revogado mostra o aviso e a data, sem o nome nem o motivo', async () => {
    renderApp(
      `/certificados/${CERTIFICATE_CODE}`,
      apiRoutes({ [VERIFY]: () => jsonResponse(REVOKED_VERIFICATION) }),
    );
    const article = await result();
    expect(within(article).getByRole('heading', { level: 2, name: t.revokedTitle })).toBeTruthy();
    expect(
      within(article).getByText(
        'Este certificado foi revogado em 22 de novembro de 2026 e não tem mais validade.',
      ),
    ).toBeTruthy();
    expect(facts(article)).toEqual({ [t.fields.code]: CERTIFICATE_CODE });
    await expectNoAxeViolations();
  });

  it('titular que removeu a conta: código, curso e data, sem o nome', async () => {
    renderApp(
      `/certificados/${CERTIFICATE_CODE}`,
      apiRoutes({ [VERIFY]: () => jsonResponse(REMOVED_VERIFICATION) }),
    );
    const article = await result();
    expect(within(article).getByRole('heading', { level: 2, name: t.removedTitle })).toBeTruthy();
    expect(within(article).getByText(t.removedText)).toBeTruthy();
    expect(facts(article)).toEqual({
      [t.fields.course]: 'React do zero',
      [t.fields.completedAt]: '20 de novembro de 2026',
      [t.fields.issuedAt]: '20 de novembro de 2026',
      [t.fields.code]: CERTIFICATE_CODE,
    });
  });

  it('código inexistente ou fora do formato mostra "certificado não encontrado"', async () => {
    renderApp(
      '/certificados/XXXX',
      apiRoutes({
        'GET /api/v1/certificates/verify/XXXX': () => problemResponse(404, 'certificate_not_found'),
      }),
    );
    const article = await result();
    expect(within(article).getByRole('heading', { level: 2, name: t.missingTitle })).toBeTruthy();
    expect(within(article).getByText(t.missingText)).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('limite de consultas vira aviso de erro, com o tempo de espera e "tentar de novo"', async () => {
    renderApp(
      `/certificados/${CERTIFICATE_CODE}`,
      apiRoutes({
        [VERIFY]: () => problemResponse(429, 'rate_limited', { headers: { 'Retry-After': '40' } }),
      }),
    );
    expect(await screen.findByText(t.errorTitle)).toBeTruthy();
    expect(inMain().getByText(/40 segundos/)).toBeTruthy();
    expect(inMain().getByRole('button', { name: ptBR.common.retry })).toBeTruthy();
  });

  it('rota ausente (404 sem o código próprio) é erro, não "não encontrado"', async () => {
    renderApp(`/certificados/${CERTIFICATE_CODE}`, apiRoutes({ [VERIFY]: missingRouteResponse }));
    expect(await screen.findByText(t.errorTitle)).toBeTruthy();
    expect(screen.queryByText(t.missingTitle)).toBeNull();
  });

  it('o formulário leva ao endereço do código digitado, e pede o código quando vazio', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(
      '/certificados',
      apiRoutes({ [VERIFY]: () => jsonResponse(VALID_VERIFICATION) }),
    );
    const field = await screen.findByRole('textbox', { name: t.field });
    expect(screen.queryByRole('article')).toBeNull();

    await user.click(screen.getByRole('button', { name: t.submit }));
    expect(screen.getByText(t.required)).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(router.state.location.pathname).toBe('/certificados');

    await user.type(field, 'abcd efgh jkmn');
    await user.click(screen.getByRole('button', { name: t.submit }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/certificados/${CERTIFICATE_CODE}`),
    );
    expect(await screen.findByRole('heading', { level: 2, name: t.validTitle })).toBeTruthy();
    await expectNoAxeViolations();
  });
});
