import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminScope,
  BillingToggle,
  BuyerForm,
  Cart,
  type CartItem,
  CartSummary,
  formatMoney,
  OrderStatusBadge,
  OrderTotals,
  PaymentResult,
  PlanGrid,
  PriceTag,
  SubscriptionStatusBadge,
} from '../index';
import { expectNoAxeViolations } from '../test/axe';

/*
 * Componentes de vendas (spec 006, RF-09 e RNF-02; specs 011 e 012): interação, teclado,
 * foco, leitor de tela, estados vazio/carregando/erro/sucesso e valor zero.
 */

const wrap = (node: React.ReactNode) => render(<AdminScope>{node}</AdminScope>);

// o Intl usa espaço não separável; o getByText normaliza para espaço simples
const moneyText = (cents: number) => (_content: string, element: Element | null) =>
  element != null && element.children.length === 0 && element.textContent === formatMoney(cents);

describe('formatMoney', () => {
  it('formata centavos na moeda e no idioma pedidos', () => {
    expect(formatMoney(9700)).toBe('R$ 97,00'.replace(' ', ' '));
    expect(formatMoney(0)).toContain('0,00');
    expect(formatMoney(1990, { currency: 'USD', locale: 'en-US' })).toBe('$19.90');
  });

  it('valor ausente ou inválido vira texto vazio', () => {
    expect(formatMoney(null)).toBe('');
    expect(formatMoney(undefined)).toBe('');
    expect(formatMoney(Number.NaN)).toBe('');
  });
});

describe('PriceTag e OrderTotals', () => {
  it('mostra o original riscado, o desconto e o valor final', async () => {
    wrap(<PriceTag cents={7760} originalCents={9700} discountLabel="-20% com o cupom BEMVINDO" />);
    expect(screen.getByText(moneyText(9700))).toBeTruthy();
    expect(screen.getByText(moneyText(7760))).toBeTruthy();
    expect(screen.getByText('-20% com o cupom BEMVINDO')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('valor zero usa o texto de gratuito quando ele vem', () => {
    wrap(<PriceTag cents={0} freeLabel="Gratuito" />);
    expect(screen.getByText('Gratuito')).toBeTruthy();
    expect(screen.queryByText(moneyText(0))).toBeNull();
  });

  it('sem texto de gratuito, zero é formatado como moeda', () => {
    wrap(<PriceTag cents={0} />);
    expect(screen.getByText(moneyText(0))).toBeTruthy();
  });

  it('totais: uma linha por entrada, total em destaque, zero preservado', async () => {
    wrap(
      <OrderTotals
        aria-label="Totais do pedido"
        rows={[
          { id: 'subtotal', label: 'Subtotal', cents: 9700 },
          { id: 'discount', label: 'Desconto', cents: -9700 },
          { id: 'total', label: 'Total', cents: 0, strong: true },
        ]}
      />,
    );
    const group = screen.getByLabelText('Totais do pedido');
    expect(within(group).getByText('Subtotal')).toBeTruthy();
    expect(within(group).getByText('Desconto')).toBeTruthy();
    const total = within(group).getByText('Total').closest('div');
    expect(total?.getAttribute('data-strong')).toBe('true');
    expect(within(total as HTMLElement).getByText(moneyText(0))).toBeTruthy();
    await expectNoAxeViolations();
  });
});

const items: CartItem[] = [
  {
    id: 'i1',
    title: 'Pacote SQL completo',
    href: '/pacotes/sql',
    kindLabel: 'Pacote',
    priceCents: 19700,
    includes: ['Curso SQL do zero', 'Ebook de consultas'],
    includesLabel: 'Inclui',
    notices: ['Você já tem o ebook pela assinatura.'],
  },
  {
    id: 'i2',
    title: 'Curso de React',
    kindLabel: 'Curso',
    priceCents: 9700,
    discountCents: 9700,
  },
];

const cartLabels = {
  region: 'Sua cesta',
  remove: (item: CartItem) => `Remover ${item.title}`,
  emptyTitle: 'Sua cesta está vazia',
  emptyText: 'Escolha um curso para começar.',
  loading: 'Carregando a cesta…',
  errorTitle: 'Não foi possível carregar a cesta',
  errorText: 'Tente de novo.',
  retry: 'Tentar de novo',
};

describe('Cart', () => {
  it('lista itens com cascata, aviso, preço com desconto e zero, sem violações', async () => {
    wrap(<Cart items={items} labels={cartLabels} onRemove={() => {}} />);
    expect(screen.getByRole('region', { name: 'Sua cesta' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pacote SQL completo' })).toHaveProperty(
      'href',
      'http://localhost:3000/pacotes/sql',
    );
    expect(screen.getByText('Curso SQL do zero')).toBeTruthy();
    expect(screen.getByText('Ebook de consultas')).toBeTruthy();
    expect(screen.getByText('Você já tem o ebook pela assinatura.')).toBeTruthy();
    // desconto de 100% no segundo item: preço final zero
    const second = screen.getByText('Curso de React').closest('li') as HTMLElement;
    expect(within(second).getByText(moneyText(0))).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('remover chama o id e fica desabilitado enquanto remove', () => {
    const onRemove = vi.fn();
    wrap(<Cart items={items} labels={cartLabels} onRemove={onRemove} removingId="i1" />);
    const button = screen.getByRole('button', { name: 'Remover Pacote SQL completo' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover Curso de React' }));
    expect(onRemove).toHaveBeenCalledWith('i2');
  });

  it('vazio tem ação sugerida; carregando e erro são anunciados', async () => {
    const { rerender } = wrap(
      <Cart
        items={[]}
        labels={cartLabels}
        emptyAction={<button type="button">Ver cursos</button>}
      />,
    );
    expect(screen.getByText('Sua cesta está vazia')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver cursos' })).toBeTruthy();
    await expectNoAxeViolations();

    rerender(
      <AdminScope>
        <Cart items={items} labels={cartLabels} loading />
      </AdminScope>,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando a cesta…');

    const onRetry = vi.fn();
    rerender(
      <AdminScope>
        <Cart items={items} labels={cartLabels} error onRetry={onRetry} />
      </AdminScope>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('o resumo reúne cupom, totais e ação de finalizar', () => {
    wrap(
      <Cart
        items={items}
        labels={cartLabels}
        summary={
          <CartSummary
            coupon={<button type="button">Aplicar cupom</button>}
            action={<button type="button">Finalizar compra</button>}
          >
            <OrderTotals rows={[{ id: 'total', label: 'Total', cents: 19700, strong: true }]} />
          </CartSummary>
        }
      />,
    );
    expect(screen.getByRole('button', { name: 'Aplicar cupom' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finalizar compra' })).toBeTruthy();
    const total = screen.getByText('Total').closest('div') as HTMLElement;
    expect(within(total).getByText(moneyText(19700))).toBeTruthy();
  });
});

function BuyerHarness(props: { onSubmit?: () => void; pending?: boolean; error?: string }) {
  const [value, setValue] = useState<import('../index').BuyerData>({
    fullName: '',
    taxIdType: 'cpf',
    taxId: '',
  });
  return (
    <AdminScope>
      <BuyerForm
        value={value}
        onChange={setValue}
        onSubmit={props.onSubmit ?? (() => {})}
        pending={props.pending ?? false}
        error={props.error}
        labels={{
          legend: 'Dados do comprador',
          fullName: 'Nome completo',
          taxIdType: 'Documento',
          cpf: 'CPF',
          cnpj: 'CNPJ',
          taxId: 'Número do documento',
          taxIdHint: 'Só números.',
          submit: 'Continuar para o pagamento',
          submitting: 'Salvando…',
        }}
        errors={{ taxId: 'CPF inválido.' }}
      />
    </AdminScope>
  );
}

describe('BuyerForm', () => {
  it('campos rotulados, erro ligado por aria-describedby, sem violações', async () => {
    render(<BuyerHarness />);
    const name = screen.getByLabelText('Nome completo');
    expect(name.getAttribute('autocomplete')).toBe('name');
    const doc = screen.getByLabelText('Número do documento');
    expect(doc.getAttribute('aria-invalid')).toBe('true');
    expect(doc.getAttribute('aria-describedby')).toContain(screen.getByText('CPF inválido.').id);
    expect(screen.getByRole('radiogroup', { name: 'Documento' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('digitação e troca de CPF/CNPJ atualizam o valor; envio chama onSubmit', () => {
    const onSubmit = vi.fn();
    render(<BuyerHarness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Nome completo'), {
      target: { value: 'Maria Silva' },
    });
    expect((screen.getByLabelText('Nome completo') as HTMLInputElement).value).toBe('Maria Silva');
    fireEvent.click(screen.getByRole('radio', { name: 'CNPJ' }));
    expect((screen.getByRole('radio', { name: 'CNPJ' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Número do documento'), {
      target: { value: '11.222.333/0001-81' },
    });
    expect((screen.getByLabelText('Número do documento') as HTMLInputElement).value).toBe(
      '11.222.333/0001-81',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o pagamento' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('pendente desabilita campos e botão; erro geral é alerta', async () => {
    render(<BuyerHarness pending error="Provedor indisponível." />);
    expect((screen.getByLabelText('Nome completo') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Salvando…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain('Provedor indisponível.');
    await expectNoAxeViolations();
  });
});

describe('OrderStatusBadge e SubscriptionStatusBadge', () => {
  it('estados do pedido com tom próprio', async () => {
    wrap(
      <>
        <OrderStatusBadge status="paid" label="Pago" />
        <OrderStatusBadge status="pending" label="Aguardando pagamento" />
        <OrderStatusBadge status="partially_refunded" label="Parcialmente reembolsado" />
        <OrderStatusBadge status="chargeback" label="Contestado" />
      </>,
    );
    expect(screen.getByText('Pago').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
      'green',
    );
    expect(
      screen.getByText('Aguardando pagamento').closest('[data-tone]')?.getAttribute('data-tone'),
    ).toBe('amber');
    expect(
      screen
        .getByText('Parcialmente reembolsado')
        .closest('[data-tone]')
        ?.getAttribute('data-tone'),
    ).toBe('blue');
    await expectNoAxeViolations();
  });

  it('estados da assinatura', () => {
    wrap(
      <>
        <SubscriptionStatusBadge status="active" label="Ativa" />
        <SubscriptionStatusBadge status="past_due" label="Em carência" />
        <SubscriptionStatusBadge status="canceling" label="Cancela no fim do período" />
      </>,
    );
    expect(screen.getByText('Ativa').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
      'green',
    );
    expect(screen.getByText('Em carência').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
      'amber',
    );
  });
});

describe('PaymentResult', () => {
  it('pendente mostra os dados para pagar e é anunciado como status', async () => {
    wrap(
      <PaymentResult
        status="pending"
        labels={{
          region: 'Estado do pagamento',
          title: 'Aguardando pagamento',
          text: 'Pague o Pix.',
        }}
        paymentDetails={<code>00020126…pix</code>}
        actions={<button type="button">Copiar código</button>}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Aguardando pagamento');
    expect(screen.getByText('00020126…pix')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('pago (inclusive total zero, provider none) mostra sucesso sem dados de pagamento', () => {
    wrap(
      <PaymentResult
        status="paid"
        labels={{
          region: 'Estado do pagamento',
          title: 'Compra concluída',
          text: 'Acesso liberado.',
        }}
        paymentDetails={<code>pix</code>}
      />,
    );
    const region = screen.getByRole('region', { name: 'Estado do pagamento' });
    expect(region.getAttribute('data-status')).toBe('paid');
    expect(screen.getByText('Compra concluída')).toBeTruthy();
    expect(screen.queryByText('pix')).toBeNull();
  });
});

const plans: import('../index').PlanCardData[] = [
  {
    id: 'p-month',
    groupKey: 'pro',
    title: 'Pro mensal',
    interval: 'month' as const,
    priceCents: 4900,
    periodLabel: '/mês',
    features: ['Todos os cursos, inclusive futuros'],
  },
  {
    id: 'p-year',
    groupKey: 'pro',
    title: 'Pro anual',
    interval: 'year' as const,
    priceCents: 47000,
    periodLabel: '/ano',
    badge: 'Mais popular',
    featured: true,
    features: ['Todos os cursos, inclusive futuros'],
  },
];

const planLabels = {
  region: 'Planos de assinatura',
  subscribe: 'Assinar',
  loading: 'Carregando os planos…',
  emptyTitle: 'Nenhum plano disponível',
  emptyText: 'Volte em breve.',
  errorTitle: 'Erro ao carregar',
  retry: 'Tentar de novo',
  billing: { group: 'Periodicidade da cobrança', month: 'Mensal', year: 'Anual', yearHint: '-20%' },
};

describe('PlanGrid e BillingToggle', () => {
  it('alterna mensal/anual pelo clique e mostra o preço do período', async () => {
    wrap(<PlanGrid plans={plans} labels={planLabels} />);
    expect(screen.getByText('Pro mensal')).toBeTruthy();
    expect(screen.queryByText('Pro anual')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Anual/ }));
    expect(screen.getByText('Pro anual')).toBeTruthy();
    expect(screen.getByText(moneyText(47000))).toBeTruthy();
    expect(screen.getByText('Mais popular')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('setas do teclado trocam a opção e movem o foco', () => {
    wrap(<PlanGrid plans={plans} labels={planLabels} />);
    const month = screen.getByRole('radio', { name: 'Mensal' });
    month.focus();
    fireEvent.keyDown(month, { key: 'ArrowRight' });
    const year = screen.getByRole('radio', { name: /Anual/ });
    expect((year as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(year);
    fireEvent.keyDown(year, { key: 'ArrowLeft' });
    expect((screen.getByRole('radio', { name: 'Mensal' }) as HTMLInputElement).checked).toBe(true);
  });

  it('assinar devolve o plano; plano desabilitado não chama', () => {
    const onSelect = vi.fn();
    wrap(
      <PlanGrid
        plans={[
          {
            ...(plans[0] as import('../index').PlanCardData),
            id: 'off',
            title: 'Pro inativo',
            disabled: true,
          },
          plans[0] as import('../index').PlanCardData,
        ]}
        labels={planLabels}
        onSelect={onSelect}
      />,
    );
    const disabledCard = screen.getByText('Pro inativo').closest('article') as HTMLElement;
    const disabledButton = within(disabledCard).getByRole('button', { name: 'Assinar' });
    expect((disabledButton as HTMLButtonElement).disabled).toBe(true);
    const activeCard = screen.getByText('Pro mensal').closest('article') as HTMLElement;
    fireEvent.click(within(activeCard).getByRole('button', { name: 'Assinar' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-month' }));
  });

  it('sem a segunda periodicidade a alternância some; vazio, carregando e erro cobertos', async () => {
    const { rerender } = wrap(
      <PlanGrid plans={[plans[0] as import('../index').PlanCardData]} labels={planLabels} />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();

    rerender(
      <AdminScope>
        <PlanGrid
          plans={[]}
          labels={planLabels}
          emptyAction={<button type="button">Ver cursos</button>}
        />
      </AdminScope>,
    );
    expect(screen.getByText('Nenhum plano disponível')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver cursos' })).toBeTruthy();
    await expectNoAxeViolations();

    rerender(
      <AdminScope>
        <PlanGrid plans={plans} labels={planLabels} loading />
      </AdminScope>,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando os planos…');

    rerender(
      <AdminScope>
        <PlanGrid plans={plans} labels={planLabels} error onRetry={() => {}} />
      </AdminScope>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('BillingToggle isolado é um radiogroup nomeado', async () => {
    wrap(
      <BillingToggle
        value="month"
        onChange={() => {}}
        labels={{ group: 'Periodicidade', month: 'Mensal', year: 'Anual' }}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Periodicidade' })).toBeTruthy();
    await expectNoAxeViolations();
  });
});
