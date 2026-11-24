import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import type { UserRole } from '../session/role';
import { RUNTIME_CONFIG, renderApp } from '../test/renderApp';

const name = ptBR.shell.administration;

describe('item "Administração"', () => {
  it.each<UserRole>(['instructor', 'manager', 'admin'])(
    'leva a equipe (%s) ao endereço do /config.json',
    async (role) => {
      renderApp('/', undefined, { role });
      const link = await screen.findByRole('link', { name });
      expect(link.getAttribute('href')).toBe(RUNTIME_CONFIG.adminUrl);
    },
  );

  it('não aparece para visitante nem para aluno', async () => {
    for (const role of [null, 'student'] as const) {
      const view = renderApp('/', undefined, { role });
      await screen.findByRole('link', { name: 'Escola Aurora' });
      expect(screen.queryByRole('link', { name })).toBeNull();
      view.unmount();
    }
  });

  it('sem o /config.json o site abre e o item não aparece, nem para a equipe', async () => {
    renderApp('/', undefined, { role: 'admin', config: null });
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Escola Aurora' })).toBeTruthy());
    expect(screen.queryByRole('link', { name })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('com o adminUrl fora do formato (campo descartado na leitura) o item não aparece', async () => {
    const { adminUrl: _dropped, ...config } = RUNTIME_CONFIG;
    renderApp('/', undefined, { role: 'admin', config });
    await screen.findByRole('link', { name: 'Escola Aurora' });
    expect(screen.queryByRole('link', { name })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
