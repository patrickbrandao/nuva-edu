import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';

function setMetaContent(attribute: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.append(tag);
  }
  tag.content = content;
}

/**
 * Título, descrição e Open Graph da página (ADR 0018). O título leva o nome da escola quando
 * `/api/v1/meta` já respondeu; antes disso, o nome do produto.
 */
export function usePageMeta(title: string, description: string): void {
  const { t } = useTranslation();
  const { data } = useMeta();
  const fullTitle = `${title} · ${data?.schoolName ?? t('app.name')}`;

  useEffect(() => {
    document.title = fullTitle;
    setMetaContent('name', 'description', description);
    setMetaContent('property', 'og:title', fullTitle);
    setMetaContent('property', 'og:description', description);
  }, [fullTitle, description]);
}
