import { describe, expect, it } from 'vitest';
import {
  billingKey,
  cartKey,
  ORDER_POLL_MS,
  orderKey,
  orderPollInterval,
  ordersKey,
} from './queries';

/*
 * Regras de dados que não dependem de tela: o acompanhamento do pedido pendente e o isolamento
 * das consultas por usuário (trocar de conta não mostra a cesta da anterior).
 */

describe('consultas de vendas', () => {
  it('acompanha só o pedido pendente', () => {
    expect(orderPollInterval('pending')).toBe(ORDER_POLL_MS);
    for (const status of [
      'paid',
      'canceled',
      'expired',
      'refunded',
      'partially_refunded',
      'chargeback',
    ] as const) {
      expect(orderPollInterval(status)).toBe(false);
    }
    // sem dados ainda (primeira consulta), não há o que acompanhar
    expect(orderPollInterval(undefined)).toBe(false);
  });

  it('separa as consultas por usuário e por estado', () => {
    expect(cartKey('ana')).toEqual(['sales', 'ana', 'cart']);
    expect(billingKey('ana')).toEqual(['sales', 'ana', 'billing']);
    expect(ordersKey('ana', 'all')).toEqual(['sales', 'ana', 'orders', 'all']);
    expect(ordersKey('ana', 'paid')).toEqual(['sales', 'ana', 'orders', 'paid']);
    expect(orderKey('ana', 'pedido-1')).toEqual(['sales', 'ana', 'order', 'pedido-1']);
    expect(cartKey('bia')).not.toEqual(cartKey('ana'));
    // visitante (sessão ainda não lida) tem chave própria
    expect(cartKey(null)).toEqual(['sales', null, 'cart']);
  });
});
