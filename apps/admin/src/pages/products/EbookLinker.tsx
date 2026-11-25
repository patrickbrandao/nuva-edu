import { AdminButton, AdminSearch, AdminStatus, AdminTag, TextLink, useToast } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import {
  type EbookSummary,
  isLinkedTo,
  type LinkTarget,
  productChanged,
  productPath,
  setEbookLink,
  useEbook,
  useProductsList,
} from '../../api/products';
import { useCan } from '../../session/session';
import { useProductError } from './errors';

interface Props {
  /** O curso ou a aula que recebe os ebooks. */
  target: LinkTarget;
  /** Nome da lista para leitores de tela, ex.: "Ebooks do curso Python". */
  label: string;
}

/**
 * Vincular e desvincular ebooks existentes de um curso ou de uma aula (spec 009, RF-06 e
 * RF-11; ação `ebook.link`). Lista os ebooks do catálogo, com busca, e mostra em cada um se já
 * está vinculado a este alvo. Quem só tem `ebook.link` (instrutor) vincula, mas não abre o
 * editor do ebook. Cada mudança é gravada na hora.
 *
 * O contrato não lista os ebooks de um curso: o vínculo de cada linha vem de
 * `GET /ebooks/{id}`, uma leitura por ebook à vista (tarefa 585 pede o campo ao contrato).
 */
export function EbookLinker({ target, label }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const list = useProductsList('ebook', { ...(q ? { q } : {}), sort: 'title' });
  const rows = (list.data?.pages.flatMap((page) => page.items) ?? []) as EbookSummary[];

  const apply = () => setQ(search.trim() || undefined);
  // o campo pode estar dentro de outro formulário (o da aula): Enter busca, não envia
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    apply();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSearch
          value={search}
          onChange={setSearch}
          onKeyDown={onKeyDown}
          label={t('products.links.search')}
          placeholder={t('courses.filters.searchPlaceholder')}
          maxLength={200}
        />
        <AdminButton onClick={apply}>{t('courses.filters.searchButton')}</AdminButton>
      </div>
      {list.isPending ? (
        <p role="status" className="m-0 text-sm text-ink-3">
          {t('products.ebook.loading')}
        </p>
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('products.ebook.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">
          {q ? t('products.ebook.emptyFiltered') : t('products.links.noEbooks')}
        </p>
      ) : (
        <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((ebook) => (
            <LinkRow key={ebook.id} ebook={ebook} target={target} />
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <div>
          <AdminButton
            disabled={list.isFetchingNextPage}
            aria-busy={list.isFetchingNextPage || undefined}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
          </AdminButton>
        </div>
      ) : null}
    </div>
  );
}

function LinkRow({ ebook, target }: { ebook: EbookSummary; target: LinkTarget }) {
  const { t } = useTranslation();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useProductError();
  const detail = useEbook(ebook.id);
  const linked = detail.data ? isLinkedTo(detail.data, target) : false;
  const change = useAction((next: boolean) => setEbookLink(api, ebook.id, target, next));

  const toggle = async () => {
    const next = !linked;
    const result = await change.run(next);
    if (result.ok) {
      productChanged(queryClient, 'ebook', result.data);
      toast.success(
        t(next ? 'products.links.linked' : 'products.links.unlinked', { title: ebook.title }),
      );
    } else {
      toast.error(message(result.error), { title: t('products.links.error') });
    }
  };

  const state = ebook.archivedAt ? 'archived' : ebook.status;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
      {can('ebook_bundle.manage') ? (
        <TextLink href={productPath('ebook', ebook.id)} quiet>
          {ebook.title}
        </TextLink>
      ) : (
        <span>{ebook.title}</span>
      )}
      <AdminStatus tone={state === 'published' ? 'green' : state === 'archived' ? 'red' : 'gray'}>
        {t(`courses.status.${state}`)}
      </AdminStatus>
      {linked ? <AdminTag>{t('products.links.linkedTag')}</AdminTag> : null}
      <span className="ml-auto">
        {detail.isError ? (
          <AdminButton size="sm" onClick={() => void detail.refetch()}>
            {t('common.retry')}
          </AdminButton>
        ) : (
          <AdminButton
            size="sm"
            disabled={detail.isPending || change.busy}
            aria-label={t(linked ? 'products.links.unlinkOf' : 'products.links.linkOf', {
              title: ebook.title,
            })}
            onClick={() => void toggle()}
          >
            {t(linked ? 'products.links.unlink' : 'products.links.link')}
          </AdminButton>
        )}
      </span>
    </li>
  );
}
