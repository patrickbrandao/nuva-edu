import type { ThemeSwitchLabels } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';

/** Textos do seletor de tema, vindos das traduções. */
export function useThemeLabels(): { labels: ThemeSwitchLabels; groupLabel: string } {
  const { t } = useTranslation();
  return {
    groupLabel: t('theme.group'),
    labels: {
      system: { label: t('theme.system.label'), hint: t('theme.system.hint') },
      light: { label: t('theme.light.label'), hint: t('theme.light.hint') },
      dark: { label: t('theme.dark.label'), hint: t('theme.dark.hint') },
    },
  };
}
