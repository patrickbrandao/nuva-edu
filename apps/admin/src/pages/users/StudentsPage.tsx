import {
  AdminButton,
  AdminEmpty,
  AdminMenu,
  AdminPageHeader,
  AdminSearch,
  AdminTable,
  LoadingState,
} from '@nuva-edu/ui';
import { UsersRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { QueryErrorState } from '../../api/problems';
import {
  DEFAULT_SORT,
  USER_ROLES,
  USER_STATUSES,
  USERS_SORTS,
  type UserRole,
  type UserStatusFilter,
  type UserSummary,
  type UsersSort,
  useUsersList,
} from '../../api/users';
import { formatDateTime } from '../../format';
import { HOME_PATH } from '../../shell/menu';
import { UserNameCell, UserStatusCell } from './UserBits';

const ALL = 'all';

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/**
 * Alunos (spec 006, mapa de telas; `GET /api/v1/users`): busca por nome ou e-mail, filtros de
 * papel e situação, ordenação e "carregar mais" por cursor. Filtros ficam no endereço (RF-07).
 */
export function StudentsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() || undefined;
  const role = pick(params.get('role'), USER_ROLES);
  const status = pick(params.get('status'), USER_STATUSES);
  const sort = pick(params.get('sort'), USERS_SORTS) ?? DEFAULT_SORT;
  const [search, setSearch] = useState(q ?? '');
  useEffect(() => setSearch(q ?? ''), [q]);

  const list = useUsersList({
    ...(q ? { q } : {}),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    sort,
  });
  const rows: UserSummary[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(q || role || status);

  const update = (key: string, value: string | undefined) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== ALL) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    update('q', search.trim() || undefined);
  };

  const roleOptions = [
    { id: ALL, label: t('users.filters.allRoles') },
    ...USER_ROLES.map((id: UserRole) => ({ id, label: t(`roles.${id}`) })),
  ];
  const statusOptions = [
    { id: ALL, label: t('users.filters.allStatuses') },
    ...USER_STATUSES.map((id: UserStatusFilter) => ({ id, label: t(`users.status.${id}`) })),
  ];
  const sortOptions = USERS_SORTS.map((id: UsersSort) => ({ id, label: t(`users.sort.${id}`) }));
  const labelOf = (options: { id: string; label: string }[], id: string) =>
    options.find((option) => option.id === id)?.label ?? '';

  const columns = [
    {
      id: 'name',
      label: t('users.columns.name'),
      render: (u: UserSummary) => <UserNameCell user={u} />,
    },
    { id: 'email', label: t('users.columns.email') },
    {
      id: 'role',
      label: t('users.columns.role'),
      render: (u: UserSummary) => t(`roles.${u.role}`),
    },
    {
      id: 'status',
      label: t('users.columns.status'),
      render: (u: UserSummary) => <UserStatusCell user={u} />,
    },
    {
      id: 'createdAt',
      label: t('users.columns.createdAt'),
      render: (u: UserSummary) => formatDateTime(u.createdAt),
    },
    {
      id: 'lastLoginAt',
      label: t('users.columns.lastLoginAt'),
      render: (u: UserSummary) =>
        u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.neverLoggedIn'),
    },
  ];

  return (
    <>
      <AdminPageHeader title={t('menu.items.students')} subtitle={t('users.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('users.filters.search')}
            placeholder={t('users.filters.searchPlaceholder')}
            maxLength={200}
          />
          <AdminButton type="submit">{t('users.filters.searchButton')}</AdminButton>
        </form>
        <AdminMenu
          options={roleOptions}
          value={role ?? ALL}
          onChange={(id: string) => update('role', id)}
          aria-label={t('users.filters.roleLabel', { value: labelOf(roleOptions, role ?? ALL) })}
        />
        <AdminMenu
          options={statusOptions}
          value={status ?? ALL}
          onChange={(id: string) => update('status', id)}
          aria-label={t('users.filters.statusLabel', {
            value: labelOf(statusOptions, status ?? ALL),
          })}
        />
        <AdminMenu
          options={sortOptions}
          value={sort}
          onChange={(id: string) => update('sort', id === DEFAULT_SORT ? undefined : id)}
          aria-label={t('users.filters.sortLabel', { value: labelOf(sortOptions, sort) })}
        />
      </div>

      {list.isPending ? (
        <LoadingState label={t('users.loading')} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('users.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            empty={
              <AdminEmpty
                icon={<UsersRound aria-hidden="true" />}
                title={filtered ? t('users.emptyFiltered') : t('users.empty')}
                text={filtered ? t('users.emptyFilteredText') : t('users.emptyText')}
              >
                {filtered ? (
                  <AdminButton onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    {t('users.filters.clear')}
                  </AdminButton>
                ) : (
                  <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
                )}
              </AdminEmpty>
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
          {list.isFetchNextPageError ? (
            <p role="alert" className="mt-2 text-center text-sm text-ink-2">
              {t('users.loadMoreError')}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
