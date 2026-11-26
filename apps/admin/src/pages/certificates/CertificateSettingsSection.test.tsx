import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { calls, defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { renderApp } from '../../test/render';

const SETTINGS = {
  signerName: 'Carla Diretora',
  signerRole: 'Diretora',
  schoolName: 'Escola Aurora',
};

function open(overrides: Routes = {}) {
  const bodies: unknown[] = [];
  const routes: Routes = {
    ...defaultRoutes('admin'),
    'GET /api/v1/settings/certificates': SETTINGS,
    'PUT /api/v1/settings/certificates': async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return { ...body, schoolName: SETTINGS.schoolName };
    },
    ...overrides,
  };
  return { ...renderApp('/configuracoes', routes), bodies };
}

const section = async () =>
  (await screen.findByRole('textbox', { name: 'Nome de quem assina' })).closest(
    'section',
  ) as HTMLElement;

describe('configurações do certificado (/configuracoes)', () => {
  it('mostra signatário e cargo; o nome da escola é só leitura; sem violações do axe', async () => {
    open();
    const name = await screen.findByRole('textbox', { name: 'Nome de quem assina' });
    expect((name as HTMLInputElement).value).toBe('Carla Diretora');
    expect(
      (screen.getByRole('textbox', { name: 'Cargo de quem assina' }) as HTMLInputElement).value,
    ).toBe('Diretora');
    const school = screen.getByRole('textbox', { name: 'Nome da escola' }) as HTMLInputElement;
    expect(school.value).toBe('Escola Aurora');
    expect(school.readOnly).toBe(true);
    // nada mudou: nada a salvar
    expect(
      (within(await section()).getByRole('button', { name: 'Salvar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await expectNoAxeViolations();
  });

  it('grava os dois campos; em branco vira nulo', async () => {
    const user = userEvent.setup();
    const { bodies } = open();
    const name = await screen.findByRole('textbox', { name: 'Nome de quem assina' });
    await user.clear(name);
    await user.type(name, 'Rui Reitor');
    await user.clear(screen.getByRole('textbox', { name: 'Cargo de quem assina' }));
    await user.click(within(await section()).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Configurações do certificado salvas.')).toBeTruthy();
    expect(bodies).toEqual([{ signerName: 'Rui Reitor', signerRole: null }]);
  });

  it('recusa de campo aparece no campo', async () => {
    const user = userEvent.setup();
    open({
      'PUT /api/v1/settings/certificates': problem(400, 'validation_failed', {
        errors: [{ path: 'body.signerName', message: 'too long' }],
      }),
    });
    const name = await screen.findByRole('textbox', { name: 'Nome de quem assina' });
    await user.type(name, ' Filho');
    await user.click(within(await section()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
  });

  it('erro ao carregar mostra o aviso com "tentar de novo"', async () => {
    const { fetchMock } = open({
      'GET /api/v1/settings/certificates': problem(500, 'internal_error'),
    });
    expect(
      await screen.findByText('Não foi possível carregar as configurações do certificado'),
    ).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/v1/settings/certificates');
  });
});
