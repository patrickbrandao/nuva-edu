import { AdminButton, AdminSearch, AdminStatus, AdminTag, TextLink, useToast } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import {
  type EbookRef,
  type EbookSummary,
  type LinkTarget,
  productPath,
  productsKeys,
  setEbookLink,
  useProductsList,
} from '../../api/products';
import { useCan } from '../../session/session';
import { useProductError } from './errors';

interface Props {
  /** O curso ou a aula que recebe os ebooks. */
  target: LinkTarget;
  /** Os ebooks já vinculados ao alvo (`CourseDetail.ebooks`, `LessonDetail.ebooks`). */
  linked: readonly EbookRef[];
  /** Lê o curso ou a aula de novo depois de vincular ou desvincular (o `204` não traz corpo). */
  onChanged: () => Promise<unknown>;
  /** Nome da lista para leitores de tela, ex.: "Ebooks do curso Python". */
  label: string;
}

/** Uma linha da lista: o ebook vinculado (só a referência) ou um da busca. */
interface Row {
  id: string;
  title: string;
  state: 'draft' | 'published' | 'archived';
  linked: boolean;
}

/**
 * Vincular e desvincular ebooks existentes de um curso ou de uma aula (spec 009, RF-06 e
 * RF-11; ação `ebook.link`). Os vinculados vêm do curso ou da aula e aparecem primeiro, mesmo
 * fora da página da busca; depois, os ebooks do catálogo, com busca. Quem só tem `ebook.link`
 * (instrutor) vincula, mas não abre o editor do ebook. Cada mudança é gravada na hora, um
 * vínculo por vez (`PUT|DELETE /ebooks/{id}/targets/{targetType}/{targetId}`).
 */
export function EbookLinker({ target, linked, onChanged, label }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const list = useProductsList('ebook', { ...(q ? { q } : {}), sort: 'title' });
  const found = (list.data?.pages.flatMap((page) => page.items) ?? []) as EbookSummary[];
  const linkedIds = new Set(linked.map((ebook) => ebook.id));
  const rows: Row[] = [
    ...linked.map((ebook) => ({
      id: ebook.id,
      title: ebook.title,
      state: ebook.status,
      linked: true,
    })),
    ...found
      .filter((ebook) => !linkedIds.has(ebook.id))
      .map((ebook) => ({
        id: ebook.id,
        title: ebook.title,
        state: ebook.archivedAt ? ('archived' as const) : ebook.status,
        linked: false,
      })),
  ];

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
      {rows.length > 0 ? (
        <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <LinkRow key={row.id} row={row} target={target} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}
      {list.isPending ? (
        <p role="status" className="m-0 text-sm text-ink-3">
          {t('products.ebook.loading')}
        </p>
      ) : list.isError && found.length === 0 ? (
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
      ) : null}
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

interface RowProps {
  row: Row;
  target: LinkTarget;
  onChanged: () => Promise<unknown>;
}

function LinkRow({ row, target, onChanged }: RowProps) {
  const { t } = useTranslation();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useProductError();
  const change = useAction(async (next: boolean) => {
    await setEbookLink(api, row.id, target, next);
    // os vínculos do ebook mudaram: o editor dele lê de novo quando abrir
    void queryClient.invalidateQueries({ queryKey: productsKeys.detail('ebook', row.id) });
    await onChanged();
  });

  const toggle = async () => {
    const next = !row.linked;
    const result = await change.run(next);
    if (result.ok) {
      toast.success(
        t(next ? 'products.links.linked' : 'products.links.unlinked', { title: row.title }),
      );
    } else {
      toast.error(message(result.error), { title: t('products.links.error') });
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
      {can('ebook_bundle.manage') ? (
        <TextLink href={productPath('ebook', row.id)} quiet>
          {row.title}
        </TextLink>
      ) : (
        <span>{row.title}</span>
      )}
      <AdminStatus
        tone={row.state === 'published' ? 'green' : row.state === 'archived' ? 'red' : 'gray'}
      >
        {t(`courses.status.${row.state}`)}
      </AdminStatus>
      {row.linked ? <AdminTag>{t('products.links.linkedTag')}</AdminTag> : null}
      <span className="ml-auto">
        <AdminButton
          size="sm"
          disabled={change.busy}
          aria-label={t(row.linked ? 'products.links.unlinkOf' : 'products.links.linkOf', {
            title: row.title,
          })}
          onClick={() => void toggle()}
        >
          {t(row.linked ? 'products.links.unlink' : 'products.links.link')}
        </AdminButton>
      </span>
    </li>
  );
}
