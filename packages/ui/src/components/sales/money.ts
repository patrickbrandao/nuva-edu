/*
 * Formatação de moeda dos componentes de vendas. Os valores trafegam em centavos, como nas
 * specs 011 e 012; a moeda e o idioma chegam por propriedade (o site os lê do GET /api/v1/meta,
 * spec 006). Nenhuma regra de negócio: isto é só apresentação.
 */

export interface MoneyOptions {
  /** Código ISO da moeda (ex.: "BRL"). */
  currency?: string | undefined;
  /** Idioma da formatação (ex.: "pt-BR"). */
  locale?: string | undefined;
}

/** "R$ 97,00" a partir de 9700 centavos. Valor nulo/indefinido vira texto vazio. */
export function formatMoney(
  cents: number | null | undefined,
  { currency = 'BRL', locale = 'pt-BR' }: MoneyOptions = {},
): string {
  if (cents == null || !Number.isFinite(cents)) return '';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
