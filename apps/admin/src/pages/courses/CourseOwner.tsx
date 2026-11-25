import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminSearch,
  AdminSection,
  AdminTag,
  Alert,
  Dialog,
  useToast,
} from '@nuva-edu/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { type CourseDetail, courseChanged } from '../../api/courses';
import { QueryErrorState } from '../../api/problems';
import { useCourseError, useFieldRefusal } from './errors';

/** Um instrutor na busca: o que a escolha precisa. */
export interface OwnerOption {
  id: string;
  name: string;
}

const SEARCH_SIZE = 10;

/**
 * Busca de instrutores (`GET /api/v1/users?role=instructor&q=`): os primeiros por nome; quem
 * não acha refina a busca, em vez de depender da primeira página.
 */
function useInstructorSearch(q: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['users', 'instructor-search', q ?? ''] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/api/v1/users', {
        params: {
          query: { role: 'instructor', ...(q ? { q } : {}), sort: 'name', limit: SEARCH_SIZE },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users respondeu sem corpo');
      return data.items;
    },
  });
}

interface PickerProps {
  /** O instrutor escolhido agora, marcado na lista. */
  chosenId: string | null | undefined;
  /** O dono gravado, marcado como "Dono atual". */
  currentId?: string | null | undefined;
  onPick: (owner: OwnerOption) => void;
}

/** Busca e escolha de um instrutor. */
function InstructorPicker({ chosenId, currentId, onPick }: PickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const list = useInstructorSearch(q);

  const apply = () => setQ(search.trim() || undefined);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    apply();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSearch
          value={search}
          onChange={setSearch}
          onKeyDown={onKeyDown}
          label={t('courses.owner.search')}
          placeholder={t('courses.owner.searchPlaceholder')}
          maxLength={200}
        />
        <AdminButton onClick={apply}>{t('courses.filters.searchButton')}</AdminButton>
      </div>
      {list.isPending ? (
        <p role="status" className="m-0 text-sm text-ink-3">
          {t('courses.owner.loading')}
        </p>
      ) : list.isError ? (
        <QueryErrorState
          error={list.error}
          title={t('courses.owner.searchError')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : list.data.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('courses.owner.noResults')}</p>
      ) : (
        <ul
          aria-label={t('courses.owner.resultsLabel')}
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {list.data.map((user) => (
            <li
              key={user.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2"
            >
              <span>{user.name}</span>
              <span className="text-sm text-ink-3">{user.email}</span>
              {user.id === currentId ? <AdminTag>{t('courses.owner.currentTag')}</AdminTag> : null}
              {user.id === chosenId && user.id !== currentId ? (
                <AdminTag>{t('courses.owner.chosenTag')}</AdminTag>
              ) : null}
              <span className="ml-auto">
                <AdminButton
                  size="sm"
                  aria-label={t('courses.owner.chooseOf', { name: user.name })}
                  aria-pressed={user.id === chosenId}
                  onClick={() => onPick({ id: user.id, name: user.name })}
                >
                  {t('courses.owner.choose')}
                </AdminButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Dono do curso (spec 009, "Autoria"; `PATCH /api/v1/courses/{id}/owner`, ação
 * `course.set_owner`): gerente e admin escolhem um instrutor ou deixam o curso sem dono. Quem
 * usa a seção confere a ação; a API é quem autoriza.
 */
export function CourseOwnerSection({ course }: { course: CourseDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <AdminSection
      title={t('courses.owner.title')}
      actions={
        <AdminButton size="sm" onClick={() => setOpen(true)}>
          {t('courses.owner.change')}
        </AdminButton>
      }
    >
      <AdminCard pad className="max-w-3xl">
        <AdminDetails
          wrap
          items={[
            {
              label: t('courses.owner.current'),
              value: course.owner?.name ?? t('courses.noOwner'),
            },
          ]}
        />
        <p className="mt-3 mb-0 text-sm text-ink-3">{t('courses.owner.hint')}</p>
      </AdminCard>
      {open ? <OwnerDialog course={course} onClose={() => setOpen(false)} /> : null}
    </AdminSection>
  );
}

function OwnerDialog({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useCourseError();
  const current = course.owner;
  // `null` é "sem dono"; começa no dono gravado
  const [choice, setChoice] = useState<OwnerOption | null>(current);

  const save = useAction(async (ownerId: string | null) => {
    const { data } = await api.PATCH('/api/v1/courses/{id}/owner', {
      params: { path: { id: course.id } },
      body: { ownerId },
    });
    if (!data) throw new Error('PATCH /api/v1/courses/{id}/owner respondeu sem corpo');
    return data;
  });
  const refusal = useFieldRefusal(save.error);
  const ownerError = refusal.of('ownerId');
  const changed = (choice?.id ?? null) !== (current?.id ?? null);

  const submit = async () => {
    const result = await save.run(choice?.id ?? null);
    if (!result.ok) return;
    courseChanged(queryClient, result.data);
    toast.success(
      result.data.owner
        ? t('courses.owner.saved', { name: result.data.owner.name })
        : t('courses.owner.removed'),
    );
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('courses.owner.dialogTitle', { title: course.title })}
      description={t('courses.owner.dialogDescription')}
      closeLabel={t('common.close')}
      dismissible={!save.busy}
      footer={
        <>
          <AdminButton disabled={save.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton
            variant="primary"
            disabled={save.busy || !changed}
            onClick={() => void submit()}
          >
            {save.busy ? t('common.saving') : t('common.save')}
          </AdminButton>
        </>
      }
    >
      {refusal.general(['ownerId']) ? (
        <Alert tone="error" className="mb-4">
          {message(save.error)}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-start gap-2">
          <AdminDetails
            wrap
            items={[
              { label: t('courses.owner.current'), value: current?.name ?? t('courses.noOwner') },
              { label: t('courses.owner.chosen'), value: choice?.name ?? t('courses.noOwner') },
            ]}
          />
          {ownerError ? (
            <span role="alert" className="text-sm text-ink">
              {ownerError}
            </span>
          ) : null}
          <AdminButton
            size="sm"
            aria-pressed={choice === null}
            onClick={() => {
              save.reset();
              setChoice(null);
            }}
          >
            {t('courses.owner.none')}
          </AdminButton>
        </div>
        <InstructorPicker
          chosenId={choice?.id ?? null}
          currentId={current?.id ?? null}
          onPick={(owner) => {
            save.reset();
            setChoice(owner);
          }}
        />
      </div>
    </Dialog>
  );
}

interface FilterProps {
  ownerId: string | undefined;
  onClose: () => void;
  /** `undefined` tira o filtro. */
  onPick: (owner: OwnerOption | undefined) => void;
}

/** Escolha do dono para o filtro da lista de cursos (`ownerId`), para gerente e admin. */
export function OwnerFilterDialog({ ownerId, onClose, onPick }: FilterProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('courses.filters.ownerTitle')}
      description={t('courses.filters.ownerDescription')}
      closeLabel={t('common.close')}
      footer={
        <>
          <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
          {ownerId ? (
            <AdminButton onClick={() => onPick(undefined)}>
              {t('courses.filters.ownerClear')}
            </AdminButton>
          ) : null}
        </>
      }
    >
      <InstructorPicker chosenId={ownerId} onPick={onPick} />
    </Dialog>
  );
}
