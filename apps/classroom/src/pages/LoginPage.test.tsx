import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { renderApp } from '../test/renderApp';

describe('login (só a estrutura)', () => {
  it('tem os campos rotulados, os links e o login social da instalação', async () => {
    renderApp('/entrar');

    expect(await screen.findByRole('heading', { level: 1, name: ptBR.login.title })).toBeTruthy();
    const email = screen.getByLabelText(ptBR.login.email);
    const password = screen.getByLabelText(ptBR.login.password);
    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('link', { name: ptBR.login.forgot }).getAttribute('href')).toBe(
      '/redefinir',
    );
    expect(screen.getByRole('link', { name: ptBR.login.signUp }).getAttribute('href')).toBe(
      '/cadastro',
    );
    expect(await screen.findByRole('button', { name: 'Continuar com Google' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${ptBR.login.title} · Escola Aurora`));
  });

  it('não autentica: enviar só avisa que o login ainda não está disponível', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp('/entrar');

    await user.type(await screen.findByLabelText(ptBR.login.email), 'aluna@exemplo.test');
    await user.type(screen.getByLabelText(ptBR.login.password), 'valor-de-teste');
    const main = screen.getByRole('main');
    await user.click(screen.getAllByRole('button', { name: ptBR.login.submit })[0] as HTMLElement);

    expect(main.querySelector('[role="status"]')?.textContent).toBe(ptBR.login.unavailable);
    expect(requests).toEqual(['/api/v1/meta']);
  });
});
