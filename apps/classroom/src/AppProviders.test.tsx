import { useToast } from '@nuva-edu/ui';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import ptBR from './locales/pt-BR.json';
import { routes } from './routes';
import { findAlert, queryAlert, renderApp } from './test/renderApp';

const notices = () => within(screen.getByRole('region', { name: ptBR.common.notices }));

/** Uma tela qualquer do site, que dispara um aviso de sucesso e um de erro ao abrir. */
function Probe() {
  const toast = useToast();
  useEffect(() => {
    toast.success('Alteração gravada.');
    toast.error('Não foi possível gravar.');
  }, [toast]);
  return <p>tela de teste</p>;
}

describe('avisos (toast) no site inteiro', () => {
  it('a região dos avisos existe em qualquer tela, vazia e fora do conteúdo', async () => {
    renderApp('/');
    const region = await screen.findByRole('region', { name: ptBR.common.notices });
    expect(screen.getByRole('main').contains(region)).toBe(false);
    expect(notices().getByRole('alert').textContent).toBe('');
    expect(notices().getByRole('status').textContent).toBe('');
    expect(queryAlert()).toBeNull();

    // outra tela, sem login: a mesma região
    renderApp('/entrar');
    expect(await screen.findAllByRole('region', { name: ptBR.common.notices })).toHaveLength(2);
  });

  it('`useToast` funciona numa tela qualquer da casca, com os textos traduzidos', async () => {
    const user = userEvent.setup();
    const shell = routes[0];
    shell?.children?.unshift({ path: '/tela-de-teste', element: <Probe /> });
    try {
      renderApp('/tela-de-teste');
      expect(await screen.findByText('tela de teste')).toBeTruthy();

      // sucesso na região educada; erro na assertiva
      expect(within(notices().getByRole('status')).getByText('Alteração gravada.')).toBeTruthy();
      const alert = await findAlert();
      expect(alert.textContent).toBe('Não foi possível gravar.');
      expect(notices().getByRole('alert')).toBe(alert);

      const dismiss = within(alert).getByRole('button', { name: ptBR.common.dismiss });
      await user.click(dismiss);
      await waitFor(() => expect(queryAlert()).toBeNull());
      expect(notices().getByText('Alteração gravada.')).toBeTruthy();
    } finally {
      shell?.children?.shift();
    }
  });
});
