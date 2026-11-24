import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, Badge, Field, LabelPill, Surface, Txt } from '../../index';

describe('primitivos', () => {
  it('Surface desenha os filhos com o tom e o tamanho pedidos', () => {
    render(
      <Surface width={300} height={96} tone="panel" data-testid="surface">
        <Txt x={14} y={28}>
          Aula publicada
        </Txt>
      </Surface>,
    );
    const surface = screen.getByTestId('surface');
    expect(surface.className).toContain('minui-surface--panel');
    expect(surface.style.width).toBe('300px');
    expect(screen.getByText('Aula publicada')).toBeTruthy();
  });

  it('Avatar sem imagem mostra as iniciais do nome', () => {
    render(<Avatar name="Ana Souza" />);
    const avatar = screen.getByRole('img', { name: 'Ana Souza' });
    expect(avatar.textContent).toBe('AS');
    expect(avatar.className).toContain('minui-avatar--initials');
  });

  it('Avatar com `src` usa a imagem e não escreve iniciais', () => {
    render(<Avatar name="Ana Souza" src="/api/v1/images/1" />);
    const avatar = screen.getByRole('img', { name: 'Ana Souza' });
    expect(avatar.style.backgroundImage).toContain('/api/v1/images/1');
    expect(avatar.textContent).toBe('');
  });

  it('Badge mostra a contagem e LabelPill o rótulo', () => {
    render(
      <>
        <Badge count={7} />
        <LabelPill label="bug" />
      </>,
    );
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('bug').className).toContain('minui-label');
  });

  it('Field mostra o texto de exemplo enquanto está vazio', () => {
    render(<Field placeholder="Responder…" />);
    expect(screen.getByText('Responder…')).toBeTruthy();
  });
});
