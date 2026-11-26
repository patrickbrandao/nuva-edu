import { isApiError } from '@nuva-edu/api-client/admin';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/*
 * Textos e formatos da operação (spec 033). Os códigos da API viram frases pelas traduções do
 * site; tamanhos e idades saem no idioma da instalação.
 */

const KNOWN = [
  'job_not_failed',
  'job_already_active',
  'email_not_failed',
  'not_found',
  'validation_failed',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação da operação. */
export function useOpsError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnown(error.code)) return t(`operations.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

const KB = 1024;

/** Bytes em B, KB, MB ou GB, com uma casa decimal a partir do KB. */
export function useBytes() {
  const { i18n } = useTranslation();
  return useCallback(
    (bytes: number): string => {
      const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
      if (bytes < KB) return `${number.format(bytes)} B`;
      if (bytes < KB * KB) return `${number.format(bytes / KB)} KB`;
      if (bytes < KB * KB * KB) return `${number.format(bytes / (KB * KB))} MB`;
      return `${number.format(bytes / (KB * KB * KB))} GB`;
    },
    [i18n.language],
  );
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Idade em segundos, curta: "45 s", "12 min", "3 h", "2 d", pelas traduções do site. */
export function useAge() {
  const { t } = useTranslation();
  return useCallback(
    (seconds: number): string => {
      if (seconds < MINUTE) {
        return t('operations.age.seconds', { value: Math.max(0, Math.round(seconds)) });
      }
      if (seconds < HOUR)
        return t('operations.age.minutes', { value: Math.round(seconds / MINUTE) });
      if (seconds < DAY) return t('operations.age.hours', { value: Math.round(seconds / HOUR) });
      return t('operations.age.days', { value: Math.round(seconds / DAY) });
    },
    [t],
  );
}
