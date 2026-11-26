import { AdminButton, AdminSection, AdminTag, TextLink, useToast } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { coursePath } from '../../api/courses';
import {
  type EbookDetail,
  type EbookTarget,
  linkTargets,
  productChanged,
  productPath,
  productsKeys,
  putEbookTargets,
} from '../../api/products';
import { ConflictAlert } from '../courses/CourseBits';
import { isVersionConflict } from '../courses/version';
import { useProductError } from './errors';

function targetHref(target: EbookTarget): string {
  if (target.targetType === 'bundle') return productPath('bundle', target.targetId);
  if (target.targetType === 'course') return coursePath(target.targetId);
  return target.course
    ? `${coursePath(target.course.id)}?aula=${encodeURIComponent(target.targetId)}`
    : '';
}

/**
 * Onde o ebook está vinculado (spec 009, "Ebooks vinculados"): cursos, aulas e os pacotes que o
 * têm como item. Daqui se desvincula de curso e de aula, gravando a lista de vínculos de curso e
 * de aula com o `version` do ebook (`PUT /ebooks/{id}/targets`); os de pacote só aparecem, e a
 * API os preserva. Vincular é no editor do curso ou da aula, e pacote se muda nos itens dele.
 */
export function EbookTargetsTab({ ebook }: { ebook: EbookDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useProductError();
  const unlink = useAction((target: EbookTarget) =>
    putEbookTargets(
      api,
      ebook,
      linkTargets(ebook).filter(
        (item) => item.targetType !== target.targetType || item.targetId !== target.targetId,
      ),
    ),
  );

  const onUnlink = async (target: EbookTarget) => {
    const result = await unlink.run(target);
    if (result.ok) {
      productChanged(queryClient, 'ebook', result.data);
      toast.success(t('products.links.unlinkedFrom', { title: target.title }));
    } else if (!isVersionConflict(result.error)) {
      toast.error(message(result.error), { title: t('products.links.error') });
    }
  };

  return (
    <AdminSection title={t('products.links.targetsTitle')}>
      <p className="mt-0 mb-3 text-sm text-ink-3">{t('products.links.targetsHint')}</p>
      {isVersionConflict(unlink.error) ? (
        <ConflictAlert
          className="mb-3"
          onReload={async () => {
            await queryClient.invalidateQueries({
              queryKey: productsKeys.detail('ebook', ebook.id),
            });
            unlink.reset();
          }}
        />
      ) : null}
      {ebook.targets.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('products.links.noTargets')}</p>
      ) : (
        <ul
          aria-label={t('products.links.targetsTitle')}
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {ebook.targets.map((target) => {
            const href = targetHref(target);
            return (
              <li
                key={`${target.targetType}:${target.targetId}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2"
              >
                <AdminTag>{t(`products.links.types.${target.targetType}`)}</AdminTag>
                {href ? (
                  <TextLink href={href} quiet>
                    {target.title}
                  </TextLink>
                ) : (
                  <span>{target.title}</span>
                )}
                {target.course ? (
                  <span className="text-sm text-ink-3">
                    {t('products.links.inCourse', { title: target.course.title })}
                  </span>
                ) : null}
                <span className="ml-auto">
                  {target.targetType === 'bundle' ? (
                    <span className="text-sm text-ink-3">{t('products.links.viaBundle')}</span>
                  ) : (
                    <AdminButton
                      size="sm"
                      disabled={unlink.busy}
                      aria-label={t('products.links.unlinkOf', { title: target.title })}
                      onClick={() => void onUnlink(target)}
                    >
                      {t('products.links.unlink')}
                    </AdminButton>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}
