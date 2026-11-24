import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketingWaitlist, PricingPage, planPrice, SnippetCard } from '../../index';

const PLANS = [
  {
    id: 'mensal',
    name: 'Mensal',
    price: { monthly: 49, yearly: 39 },
    cta: 'Assinar',
    features: ['Todos os cursos'],
  },
  { id: 'gratis', name: 'Grátis', price: 0, cta: 'Começar' },
];

describe('PricingPage', () => {
  it('planPrice devolve o preço do ciclo', () => {
    expect(planPrice(PLANS[0], 'monthly')).toBe(49);
    expect(planPrice(PLANS[0], 'yearly')).toBe(39);
    expect(planPrice(PLANS[1], 'yearly')).toBe(0);
  });

  it('troca o ciclo e avisa o plano escolhido', () => {
    const onSelect = vi.fn();
    render(
      <PricingPage
        plans={PLANS}
        title="Planos"
        currency="R$ "
        period="/mês"
        billingLabels={{ monthly: 'Mensal', yearly: 'Anual' }}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeTruthy();
    expect(screen.getByText('R$ 39')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Mensal' }));
    expect(screen.getByText('R$ 49')).toBeTruthy();
    expect(screen.getByText('Todos os cursos')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(onSelect.mock.calls[0]?.slice(0, 2)).toEqual(['mensal', 'monthly']);
  });
});

describe('vitrine', () => {
  it('MarketingWaitlist mostra título, campo e botão com os textos recebidos', () => {
    render(
      <MarketingWaitlist
        title="Novos cursos a caminho"
        lead="Deixe seu e-mail."
        placeholder="voce@example.com"
        joinLabel="Quero saber"
        people={['Ana Souza']}
        features={[]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Novos cursos a caminho' })).toBeTruthy();
    expect(screen.getByPlaceholderText('voce@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quero saber' })).toBeTruthy();
  });

  it('SnippetCard mostra etiqueta, descrição e o link de abrir', () => {
    render(
      <SnippetCard tag="curso" description="SQL do zero" path="/cursos/sql" href="/cursos/sql" />,
    );
    expect(screen.getByText('curso')).toBeTruthy();
    expect(screen.getByText('SQL do zero')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir /cursos/sql' }).getAttribute('href')).toBe(
      '/cursos/sql',
    );
  });
});
