import i18n from './i18n/i18n';

/*
 * Datas na língua do site e no fuso do navegador. A API manda instantes em UTC (`Z`); a tela
 * mostra a hora local de quem vê.
 */
const dateTime = () =>
  new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' });

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime().format(new Date(value)) : '';
}

export function formatDate(value: string | null | undefined): string {
  return value ? dateOnly().format(new Date(value)) : '';
}
