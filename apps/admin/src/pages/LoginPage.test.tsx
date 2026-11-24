import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';

describe('página de login', () => {
  it('mostra só a estrutura: campos rotulados, envio desligado e aviso', async () => {
    const { fetchMock } = renderApp('/entrar');

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('password');
    expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('note').textContent).toBe(
      'O acesso ao painel ainda não está disponível nesta versão.',
    );
    expect(await screen.findByText('Escola Aurora · Administração')).toBeTruthy();

    // Fora da casca: sem menu lateral; com tema e com o link do código-fonte.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('group', { name: 'Tema da página' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Código-fonte/ })).toBeTruthy();

    // Nenhuma chamada além dos dados públicos da instalação.
    const paths = fetchMock.mock.calls.map(([input]) => new URL((input as Request).url).pathname);
    expect(new Set(paths)).toEqual(new Set(['/api/v1/meta']));
  });
});
