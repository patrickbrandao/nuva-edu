import { describe, expect, it } from 'vitest';
import {
  allocateCouponDiscount,
  cents,
  centsOrNull,
  decodeSalesCursor,
  encodeSalesCursor,
  isCouponAppliesTo,
  isCouponKind,
  isOrderStatus,
  isPaidOrderStatus,
  isSalesProductType,
  isTaxIdType,
  isUuid,
  isValidCnpj,
  isValidCpf,
  normalizeTaxId,
  readRefundItems,
  serializeRefundItems,
  sumDiscount,
  sumPrices,
  validateTaxId,
} from '../../src/index.ts';

// Regras puras de vendas: rateio do cupom, documento fiscal e leitura dos valores gravados.

const courseA = '11111111-1111-4111-8111-111111111111';
const courseB = '22222222-2222-4222-8222-222222222222';
const ebook = '33333333-3333-4333-8333-333333333333';

describe('rateio do cupom', () => {
  it('percentual desconta item a item, arredondando para baixo', () => {
    const allocation = allocateCouponDiscount(
      { kind: 'percent', percentOff: 10, amountOffCents: null, products: [] },
      [
        { id: 'a', productType: 'course', productId: courseA, unitPriceCents: 999 },
        { id: 'b', productType: 'course', productId: courseB, unitPriceCents: 101 },
      ],
    );
    expect(allocation.get('a')).toBe(99);
    expect(allocation.get('b')).toBe(10);
  });

  it('percentual de 100% deixa cada item com o preço cheio de desconto', () => {
    const allocation = allocateCouponDiscount(
      { kind: 'percent', percentOff: 100, amountOffCents: null, products: [] },
      [{ id: 'a', productType: 'course', productId: courseA, unitPriceCents: 4_900 }],
    );
    expect(allocation.get('a')).toBe(4_900);
  });

  it('valor fixo rateia na proporção e deixa o resto no último item', () => {
    const lines = [
      { id: 'a', productType: 'course' as const, productId: courseA, unitPriceCents: 333 },
      { id: 'b', productType: 'course' as const, productId: courseB, unitPriceCents: 333 },
      { id: 'c', productType: 'ebook' as const, productId: ebook, unitPriceCents: 334 },
    ];
    const allocation = allocateCouponDiscount(
      { kind: 'fixed', percentOff: null, amountOffCents: 100, products: [] },
      lines,
    );
    expect([...allocation.values()]).toEqual([33, 33, 34]);
    expect(sumDiscount(allocation)).toBe(100);
    for (const line of lines) {
      expect(allocation.get(line.id)).toBeLessThanOrEqual(line.unitPriceCents);
    }
  });

  it('valor fixo acima do subtotal elegível fica limitado ao subtotal', () => {
    const allocation = allocateCouponDiscount(
      { kind: 'fixed', percentOff: null, amountOffCents: 10_000, products: [] },
      [{ id: 'a', productType: 'course', productId: courseA, unitPriceCents: 4_900 }],
    );
    expect(allocation.get('a')).toBe(4_900);
  });

  it('não desconta item inelegível, item de preço zero nem cupom sem valor', () => {
    const restricted = allocateCouponDiscount(
      {
        kind: 'fixed',
        percentOff: null,
        amountOffCents: 500,
        products: [{ productType: 'course', productId: courseA }],
      },
      [
        { id: 'a', productType: 'course', productId: courseA, unitPriceCents: 1_000 },
        { id: 'b', productType: 'course', productId: courseB, unitPriceCents: 1_000 },
        { id: 'free', productType: 'ebook', productId: ebook, unitPriceCents: 0 },
      ],
    );
    expect(restricted.get('a')).toBe(500);
    expect(restricted.has('b')).toBe(false);
    expect(restricted.has('free')).toBe(false);

    const nothing = allocateCouponDiscount(
      { kind: 'fixed', percentOff: null, amountOffCents: 0, products: [] },
      [{ id: 'a', productType: 'course', productId: courseA, unitPriceCents: 1_000 }],
    );
    expect(nothing.size).toBe(0);
  });

  it('soma o preço dos itens', () => {
    expect(
      sumPrices([
        { id: 'a', productType: 'course', productId: courseA, unitPriceCents: 100 },
        { id: 'b', productType: 'ebook', productId: ebook, unitPriceCents: 250 },
      ]),
    ).toBe(350);
  });
});

describe('documento fiscal', () => {
  it('normaliza para maiúsculas sem pontuação', () => {
    expect(normalizeTaxId('529.982.247-25')).toBe('52998224725');
    expect(normalizeTaxId('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('aceita CPF válido e recusa dígito errado ou repetido', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('12345678900')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
  });

  it('aceita CNPJ numérico e alfanumérico válidos', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });

  it('valida pelo tipo e devolve o documento normalizado', () => {
    expect(validateTaxId('529.982.247-25', 'cpf')).toBe('52998224725');
    expect(validateTaxId('12.abc.345/01de-35', 'cnpj')).toBe('12ABC34501DE35');
    expect(validateTaxId('52998224725', 'cnpj')).toBeNull();
    expect(validateTaxId('11222333000181', 'cpf')).toBeNull();
  });
});

describe('valores gravados', () => {
  it('lê os itens de reembolso sem confiar no JSON', () => {
    expect(
      readRefundItems([
        { orderItemId: courseA, amountCents: 100 },
        { orderItemId: courseB, amountCents: -1 },
        { orderItemId: ebook, amountCents: 2.5 },
        { amountCents: 10 },
        'lixo',
      ] as never),
    ).toEqual([{ orderItemId: courseA, amountCents: 100 }]);
    expect(readRefundItems(null)).toEqual([]);
    expect(serializeRefundItems([{ orderItemId: courseA, amountCents: 100 }])).toEqual([
      { orderItemId: courseA, amountCents: 100 },
    ]);
  });

  it('cursor opaco volta ao mesmo ponto e não aceita outro escopo', () => {
    const createdAt = new Date('2026-11-24T10:15:00.000Z');
    const cursor = encodeSalesCursor('my-orders', createdAt, courseA);
    expect(decodeSalesCursor(cursor, 'my-orders')).toEqual({ createdAt, id: courseA });
    expect(decodeSalesCursor(cursor, 'admin-orders')).toBeUndefined();
    expect(decodeSalesCursor('não é base64', 'my-orders')).toBeUndefined();
    expect(decodeSalesCursor(42, 'my-orders')).toBeUndefined();
  });

  it('converte bigint e nulo em centavos', () => {
    expect(cents('9900')).toBe(9_900);
    expect(cents(7n)).toBe(7);
    expect(cents(null)).toBe(0);
    expect(centsOrNull('42')).toBe(42);
    expect(centsOrNull(null)).toBeNull();
  });
});

describe('guardas de tipo', () => {
  it('reconhece os valores do contrato', () => {
    expect(isSalesProductType('bundle')).toBe(true);
    expect(isSalesProductType('plan')).toBe(false);
    expect(isOrderStatus('partially_refunded')).toBe(true);
    expect(isOrderStatus('draft')).toBe(true);
    expect(isPaidOrderStatus('refunded')).toBe(true);
    expect(isPaidOrderStatus('pending')).toBe(false);
    expect(isTaxIdType('cnpj')).toBe(true);
    expect(isTaxIdType('rg')).toBe(false);
    expect(isCouponKind('fixed')).toBe(true);
    expect(isCouponAppliesTo('both')).toBe(true);
    expect(isUuid(courseA)).toBe(true);
    expect(isUuid('não é uuid')).toBe(false);
  });
});
