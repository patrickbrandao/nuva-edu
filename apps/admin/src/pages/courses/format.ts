import i18n from '../../i18n/i18n';

/*
 * Duração e preço no editor de curso. A API guarda segundos e centavos; a tela mostra e recebe
 * `mm:ss` (ou `h:mm:ss`) e o valor na moeda da escola (`currency` do `/meta`).
 */

/** `754` → `12:34`; `3930` → `1:05:30`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Lê `mm:ss`, `h:mm:ss` ou só minutos (`12`). Vazio é `null` (sem duração); texto fora do
 * formato é `undefined`.
 */
export function parseDuration(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d{1,5}(:[0-5]?\d){0,2}$/.test(value)) return undefined;
  const parts = value.split(':').map(Number);
  if (parts.length === 1) return (parts[0] ?? 0) * 60;
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

/** Centavos na moeda da escola: `4990` → `R$ 49,90`. */
export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(cents / 100);
}

/** Centavos como o campo de preço os mostra: `4990` → `49,90`. */
export function priceInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Lê o campo de preço (`49,90`, `49.90`, `49`, `1.234,56`). Vazio é `null`; texto fora do
 * formato é `undefined`.
 */
export function parsePrice(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return undefined;
  return Math.round(Number(normalized) * 100);
}

/** Inteiro positivo de um campo numérico. Vazio é `null`; fora da faixa é `undefined`. */
export function parseWhole(text: string, min: number, max: number): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d{1,9}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : undefined;
}
