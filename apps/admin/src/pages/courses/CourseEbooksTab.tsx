import { AdminSection } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import type { CourseDetail } from '../../api/courses';
import { EbookLinker } from '../products/EbookLinker';

/**
 * Ebooks vinculados ao curso (spec 009, RF-06): quem tem direito ao curso recebe o ebook. O
 * instrutor vincula ebooks existentes aos próprios cursos; criar e editar ebook é de gerente e
 * admin, na tela de ebooks.
 */
export function CourseEbooksTab({ course }: { course: CourseDetail }) {
  const { t } = useTranslation();
  return (
    <AdminSection title={t('products.links.courseTitle')}>
      <p className="mt-0 mb-3 text-sm text-ink-3">{t('products.links.courseHint')}</p>
      <EbookLinker
        target={{ targetType: 'course', targetId: course.id }}
        label={t('products.links.courseList', { title: course.title })}
      />
    </AdminSection>
  );
}
