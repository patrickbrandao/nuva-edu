import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptBR from '../locales/pt-BR.json';

/** Idioma único do MVP (spec 006, RF-05). Idioma novo: um arquivo em `locales/` e uma linha aqui. */
export const DEFAULT_LOCALE = 'pt-BR';
export const resources = { [DEFAULT_LOCALE]: { translation: ptBR } } as const;

// Os textos vão no pacote do site, então a inicialização é síncrona: a primeira pintura já sai traduzida.
void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  initAsync: false,
  interpolation: { escapeValue: false },
});

export default i18n;
