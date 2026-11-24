import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorState,
  type LinkComponent,
  LinkProvider,
  LoadingState,
  PageTitle,
  TextLink,
} from '../../index';

const RouterLink: LinkComponent = ({ href, onClick, ...rest }) => (
  <a
    {...rest}
    href={href}
    data-router="sim"
    onClick={(event) => {
      onClick?.(event);
      event.preventDefault();
    }}
  />
);

describe('primitivos de fluxo', () => {
  it('PageTitle desenha o h1 e a frase de apoio', () => {
    render(
      <PageTitle subtitle="Tudo o que você comprou" align="center">
        Meus cursos
      </PageTitle>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Meus cursos' });
    expect(heading.parentElement?.getAttribute('data-align')).toBe('center');
    expect(screen.getByText('Tudo o que você comprou')).toBeTruthy();
  });

  it('PageTitle aceita outro nível de cabeçalho', () => {
    render(<PageTitle as="h2">Sobre a escola</PageTitle>);
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre a escola' })).toBeTruthy();
  });

  it('TextLink interno usa o componente de link do site', () => {
    render(
      <LinkProvider component={RouterLink}>
        <TextLink href="/termos">Termos de uso</TextLink>
      </LinkProvider>,
    );
    const link = screen.getByRole('link', { name: 'Termos de uso' });
    expect(link.getAttribute('href')).toBe('/termos');
    expect(link.getAttribute('data-router')).toBe('sim');
    expect(link.className).toContain('minui-text-link');
  });

  it('TextLink externo abre em outra aba, fora do roteador, e avisa o leitor de tela', () => {
    render(
      <LinkProvider component={RouterLink}>
        <TextLink href="https://example.com/codigo" external newTabLabel="(abre em nova aba)">
          Código-fonte
        </TextLink>
      </LinkProvider>,
    );
    const link = screen.getByRole('link', { name: /Código-fonte/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(link.hasAttribute('data-router')).toBe(false);
    expect(within(link).getByText(/abre em nova aba/)).toBeTruthy();
  });
});

describe('estados de uma área', () => {
  it('LoadingState anuncia o texto como status', () => {
    render(<LoadingState label="Carregando os cursos…" />);
    expect(screen.getByRole('status').textContent).toBe('Carregando os cursos…');
  });

  it('ErrorState é um alerta com título, texto, detalhe e "tentar de novo"', () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Não foi possível carregar"
        text="Confira a conexão."
        detail="Requisição abc-123"
        retryLabel="Tentar de novo"
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Não foi possível carregar')).toBeTruthy();
    expect(within(alert).getByText('Confira a conexão.')).toBeTruthy();
    expect(within(alert).getByText('Requisição abc-123')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState desabilita o botão durante a nova tentativa e some com ele sem onRetry', () => {
    const { rerender } = render(
      <ErrorState title="Falhou" retryLabel="Tentar de novo" onRetry={() => {}} retrying />,
    );
    expect(screen.getByRole('button', { name: 'Tentar de novo' }).hasAttribute('disabled')).toBe(
      true,
    );
    rerender(<ErrorState text="Recarregue a página." />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert').querySelector('strong')).toBeNull();
  });
});
