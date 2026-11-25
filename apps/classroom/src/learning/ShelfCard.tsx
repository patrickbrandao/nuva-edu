import { AdminButton, ProductCard, type ProductCardLayout } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { productPath } from '../catalog/format';
import { coursePath, lessonPath } from './progress';
import type { ShelfCourse } from './shelf';

interface ShelfCardProps {
  course: ShelfCourse;
  layout: ProductCardLayout;
  formatDate: (iso: string) => string;
}

/** Para onde a ação do cartão leva: a aula do "Continuar", o curso, ou a página pública. */
export function shelfActionPath(course: ShelfCourse): string {
  if (course.action === 'renew') return productPath('course', course.slug);
  return course.continueLessonId
    ? lessonPath(course.slug, course.continueLessonId)
    : coursePath(course.slug);
}

/**
 * Um curso da estante (spec 014): capa, nível, "X de Y aulas" com a barra, validade do acesso e a
 * ação. Acesso vencido leva o selo e mantém o progresso; a ação passa a ser "Renovar acesso", que
 * abre a página pública do curso.
 */
export function ShelfCard({ course, layout, formatDate }: ShelfCardProps) {
  const { t } = useTranslation();
  const { progress, access } = course;
  const expired = access.state === 'expired';
  const counts = { completed: progress.completedLessons, count: progress.totalLessons };
  const action = t(`study.shelf.actions.${course.action}`);
  const validity = access.expiresAt
    ? t(expired ? 'study.shelf.expiredOn' : 'study.shelf.accessUntil', {
        date: formatDate(access.expiresAt),
      })
    : undefined;
  return (
    <ProductCard
      layout={layout}
      headingLevel={3}
      title={course.title}
      href={coursePath(course.slug)}
      coverUrl={course.cover?.url}
      level={course.level ? t(`product.levels.${course.level}`) : undefined}
      badge={expired ? t('study.shelf.expired') : undefined}
      badgeTone="warning"
      meta={validity}
      progress={{
        value: progress.percent,
        label: t('study.shelf.progressOf', { title: course.title }),
        valueText: t('learning.progress.lessonsDone', counts),
        caption: t('learning.progress.lessons', counts),
      }}
      action={
        <AdminButton
          href={shelfActionPath(course)}
          variant={course.action === 'review' ? 'default' : 'primary'}
          // o nome lido começa pelo texto visível (WCAG 2.5.3) e diz de que curso se trata
          aria-label={t('study.shelf.actionOf', { action, title: course.title })}
        >
          {action}
        </AdminButton>
      }
    />
  );
}
