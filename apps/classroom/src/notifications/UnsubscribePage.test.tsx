import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { UNSUBSCRIBE_TOKEN, unsubscribeUrl } from '../test/notifications';
import { apiRoutes, jsonResponse, problemResponse, renderApp } from '../test/renderApp';

const t = ptBR.notifications.unsubscribe;
const group = ptBR.notifications.preferences.groups.forum;

describe('/descadastro/:token', () => {
  it('consome o token sem login, sem CSRF, e diz que só o e-mail daquele grupo saiu', async () => {
    const { calls } = renderApp(
      `/descadastro/${UNSUBSCRIBE_TOKEN}`,
      apiRoutes({
        [unsubscribeUrl(UNSUBSCRIBE_TOKEN)]: () =>
          jsonResponse({ group: 'forum', prefs: { inApp: true, email: false } }),
      }),
    );

    expect(await screen.findByText(t.doneTitle)).toBeTruthy();
    expect(screen.getByText(t.doneText.replace('{{group}}', group))).toBeTruthy();
    expect(screen.getByText(t.inAppNote.replace('{{group}}', group))).toBeTruthy();

    const sent = calls.filter((call) => call.method === 'POST');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(`/api/v1/unsubscribe/${UNSUBSCRIBE_TOKEN}`);
    expect(sent[0]?.csrf).toBeNull();

    await expectNoAxeViolations();
  });

  it('token fora do formato não chega à API e a página explica o link inválido', async () => {
    const { calls } = renderApp('/descadastro/nao-e-token');
    expect(await screen.findByText(t.invalidTitle)).toBeTruthy();
    expect(screen.getByText(t.invalidText)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('token desconhecido (404) aparece como link inválido, sem quebrar a página', async () => {
    renderApp(
      `/descadastro/${UNSUBSCRIBE_TOKEN}`,
      apiRoutes({
        [unsubscribeUrl(UNSUBSCRIBE_TOKEN)]: () => problemResponse(404, 'not_found'),
      }),
    );

    expect(await screen.findByText(t.invalidTitle)).toBeTruthy();
    expect(screen.queryByText(t.doneTitle)).toBeNull();
  });

  it('o link de volta leva à vitrine', async () => {
    renderApp(
      `/descadastro/${UNSUBSCRIBE_TOKEN}`,
      apiRoutes({
        [unsubscribeUrl(UNSUBSCRIBE_TOKEN)]: () =>
          jsonResponse({ group: 'events', prefs: { inApp: true, email: false } }),
      }),
    );

    await waitFor(() => expect(screen.getByText(t.doneTitle)).toBeTruthy());
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: t.backHome }).getAttribute('href')).toBe('/');
    expect(
      screen.getByText(
        t.doneText.replace('{{group}}', ptBR.notifications.preferences.groups.events),
      ),
    ).toBeTruthy();
  });
});
