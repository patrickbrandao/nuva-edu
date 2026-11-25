import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminMenu,
  AdminSearch,
  AdminTabs,
  Dialog,
  ErrorState,
  LoadingState,
  PageTitle,
  TextLink,
} from '@nuva-edu/ui';
import { Clock, NotebookPen, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { describeError } from '../api/errors';
import { useDateFormatter } from '../catalog/format';
import { useShelf } from '../learning/shelf';
import { usePageMeta } from '../lib/usePageMeta';
import { DeleteNoteDialog } from '../notes/DeleteNoteDialog';
import { NoteEditor } from '../notes/NoteEditor';
import {
  formatInstant,
  NOTE_SEARCH_MAX,
  type NoteFilters,
  type NoteKind,
  type NoteSummary,
  noteLessonPath,
  noteName,
  useNote,
  useNotes,
} from '../notes/notes';
import { RequireSession } from '../session/RequireSession';
import { MY_COURSES_PATH } from '../shell/navigation';

/** Espera depois da última tecla antes de buscar. */
const SEARCH_DELAY_MS = 300;
const ALL = 'all';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Como na estante, os filtros moram no endereço, em português.
const KINDS: Record<string, NoteKind> = { aulas: 'lesson', avulsas: 'standalone' };

function readFilters(params: URLSearchParams): NoteFilters {
  const filters: NoteFilters = {};
  const kind = KINDS[params.get('tipo') ?? ''];
  const courseId = params.get('curso') ?? '';
  const q = (params.get('q') ?? '').trim().slice(0, NOTE_SEARCH_MAX);
  if (kind) filters.kind = kind;
  if (UUID.test(courseId)) filters.courseId = courseId;
  if (q) filters.q = q;
  return filters;
}

function writeFilters(filters: NoteFilters): URLSearchParams {
  const params = new URLSearchParams();
  const kind = Object.keys(KINDS).find((key) => KINDS[key] === filters.kind);
  if (kind) params.set('tipo', kind);
  if (filters.courseId) params.set('curso', filters.courseId);
  if (filters.q) params.set('q', filters.q);
  return params;
}

/** Um item da lista: título (ou o início do texto), trecho, data e, nas de aula, o link de volta. */
function NoteRow({
  note,
  onEdit,
  onDelete,
}: {
  note: NoteSummary;
  onEdit: (note: NoteSummary) => void;
  onDelete: (note: NoteSummary) => void;
}) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const name = noteName(note);
  const back = noteLessonPath(note.lesson, note.videoSeconds);
  const where = note.lesson
    ? t('notes.page.lessonOf', { lesson: note.lesson.title, course: note.lesson.courseTitle })
    : null;
  return (
    <li>
      <AdminCard pad as="article">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 break-words text-base font-semibold text-ink">{name}</h2>
          {note.title && note.excerpt ? (
            <p className="m-0 break-words text-sm text-ink-2">{note.excerpt}</p>
          ) : null}
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span>{formatDate(note.updatedAt)}</span>
            {where ? (
              back ? (
                <TextLink href={back}>{where}</TextLink>
              ) : (
                <span>
                  {where} <span>{t('notes.page.unavailable')}</span>
                </span>
              )
            ) : (
              <span>{t('notes.page.standalone')}</span>
            )}
            {note.videoSeconds !== null ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden="true" />
                {t('notes.instant.at', { time: formatInstant(note.videoSeconds) })}
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <AdminButton
              size="sm"
              aria-label={t('notes.actions.editOf', { name })}
              onClick={() => onEdit(note)}
            >
              {t('notes.actions.edit')}
            </AdminButton>
            <AdminButton
              size="sm"
              variant="ghost"
              aria-label={t('notes.actions.deleteOf', { name })}
              onClick={() => onDelete(note)}
            >
              {t('notes.actions.delete')}
            </AdminButton>
          </div>
        </div>
      </AdminCard>
    </li>
  );
}

/** Diálogo de escrita: nota avulsa nova (`id` nulo) ou a nota escolhida na lista, lida inteira. */
function NoteDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const query = useNote(id);
  let body = null;
  if (id === null) {
    body = <NoteEditor initial={null} showTitle rows={8} label={t('notes.editor.body')} />;
  } else if (query.isPending) {
    body = <LoadingState label={t('notes.page.loadingNote')} />;
  } else if (query.isError) {
    const failure = describeError(t, query.error, { not_found: t('notes.errors.gone') });
    body = (
      <ErrorState
        title={t('notes.page.noteErrorTitle')}
        text={failure.message}
        detail={failure.detail}
        retryLabel={t('common.retry')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else {
    body = (
      <NoteEditor
        key={query.data.id}
        initial={query.data}
        showTitle
        rows={8}
        label={t('notes.editor.body')}
        onDeleted={onClose}
      />
    );
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={id === null ? t('notes.page.new') : t('notes.page.editTitle')}
      closeLabel={t('notes.editor.close')}
      closeOnBackdrop={false}
      footer={
        <AdminButton variant="primary" onClick={onClose}>
          {t('notes.editor.done')}
        </AdminButton>
      }
    >
      {body}
    </Dialog>
  );
}

function NotesContent() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const notes = useNotes(filters);
  const shelf = useShelf({});
  /** `'new'`, o id da nota em edição, ou fechado. */
  const [open, setOpen] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<NoteSummary | null>(null);

  const applied = filters.q ?? '';
  const [search, setSearch] = useState(applied);
  const [lastApplied, setLastApplied] = useState(applied);
  if (applied !== lastApplied) {
    setLastApplied(applied);
    setSearch(applied);
  }
  const update = (next: NoteFilters) => setParams(writeFilters(next), { replace: true });

  useEffect(() => {
    const q = search.trim();
    if (q === applied) return undefined;
    const timer = window.setTimeout(() => {
      const { q: _old, ...rest } = readFilters(params);
      setParams(writeFilters(q ? { ...rest, q } : rest), { replace: true });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, applied, params, setParams]);

  const dialogs = (
    <>
      {open !== null ? (
        <NoteDialog id={open === 'new' ? null : open} onClose={() => setOpen(null)} />
      ) : null}
      <DeleteNoteDialog note={toDelete} onClose={() => setToDelete(null)} />
    </>
  );
  const newButton = (
    <AdminButton
      variant="primary"
      icon={<Plus size={14} aria-hidden="true" />}
      onClick={() => setOpen('new')}
    >
      {t('notes.page.new')}
    </AdminButton>
  );
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PageTitle>{t('menu.items.notes')}</PageTitle>
      {newButton}
    </div>
  );

  if (notes.isPending) {
    return (
      <>
        <PageTitle>{t('menu.items.notes')}</PageTitle>
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('notes.page.loading')} />
        </AdminCard>
      </>
    );
  }
  if (notes.isError) {
    const failure = describeError(t, notes.error);
    return (
      <>
        <PageTitle>{t('menu.items.notes')}</PageTitle>
        <AdminCard pad>
          <ErrorState
            title={t('notes.page.errorTitle')}
            text={failure.message}
            detail={failure.detail}
            retryLabel={t('common.retry')}
            onRetry={() => void notes.refetch()}
            retrying={notes.isFetching}
          />
        </AdminCard>
      </>
    );
  }

  const items = notes.data.pages.flatMap((page) => page.items);
  const narrowed = Boolean(filters.kind || filters.courseId || filters.q);

  if (items.length === 0 && !narrowed) {
    return (
      <>
        <PageTitle>{t('menu.items.notes')}</PageTitle>
        <AdminCard pad>
          <AdminEmpty icon={<NotebookPen aria-hidden="true" />} title={t('notes.page.emptyTitle')}>
            <ol className="m-0 mt-2 flex list-decimal flex-col gap-1 pl-5 text-left text-sm text-ink-2">
              <li>{t('notes.page.steps.open')}</li>
              <li>{t('notes.page.steps.tab')}</li>
              <li>{t('notes.page.steps.write')}</li>
            </ol>
            <span className="mt-3 flex flex-wrap justify-center gap-2">
              <AdminButton href={MY_COURSES_PATH} variant="primary">
                {t('notes.page.goToCourses')}
              </AdminButton>
              <AdminButton onClick={() => setOpen('new')}>{t('notes.page.writeIdea')}</AdminButton>
            </span>
          </AdminEmpty>
        </AdminCard>
        {dialogs}
      </>
    );
  }

  // cursos do filtro: os da estante e, se o escolhido não está nela, o que as notas dizem dele
  const courses = (shelf.data?.items ?? []).map((course) => ({
    id: course.id,
    label: course.title,
  }));
  if (filters.courseId && !courses.some((course) => course.id === filters.courseId)) {
    const known = items.find((note) => note.lesson?.courseId === filters.courseId)?.lesson;
    courses.push({
      id: filters.courseId,
      label: known?.courseTitle ?? t('notes.page.filters.otherCourse'),
    });
  }
  const courseOptions = [{ id: ALL, label: t('notes.page.filters.allCourses') }, ...courses];
  const course = filters.courseId ?? ALL;

  return (
    <>
      {header}
      <search aria-label={t('notes.page.filters.label')} className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <AdminTabs
            label={t('notes.page.filters.kinds')}
            value={filters.kind ?? ALL}
            onChange={(id: string) => {
              const { kind: _old, ...rest } = filters;
              update(id === ALL ? rest : { ...rest, kind: id as NoteKind });
            }}
            tabs={[
              { id: ALL, label: t('notes.page.filters.all') },
              { id: 'lesson', label: t('notes.page.filters.lesson') },
              { id: 'standalone', label: t('notes.page.filters.standalone') },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminSearch
            className="min-w-0 flex-1 basis-56"
            value={search}
            onChange={setSearch}
            label={t('notes.page.filters.search')}
            placeholder={t('notes.page.filters.searchPlaceholder')}
            maxLength={NOTE_SEARCH_MAX}
          />
          {courses.length > 0 ? (
            <AdminMenu
              options={courseOptions}
              value={course}
              onChange={(id: string) => {
                const { courseId: _old, ...rest } = filters;
                update(id === ALL ? rest : { ...rest, courseId: id });
              }}
              // o nome lido contém o texto visível (WCAG 2.5.3) e diz de que escolha se trata
              aria-label={`${t('notes.page.filters.course')}: ${
                courseOptions.find((option) => option.id === course)?.label ?? ''
              }`}
            />
          ) : null}
        </div>
      </search>

      {items.length === 0 ? (
        <AdminCard>
          <AdminEmpty
            icon={<SearchX aria-hidden="true" />}
            title={t('notes.page.noResultsTitle')}
            text={t('notes.page.noResultsText')}
          >
            <span className="mt-3 flex">
              <AdminButton onClick={() => update({})}>{t('notes.page.filters.clear')}</AdminButton>
            </span>
          </AdminEmpty>
        </AdminCard>
      ) : (
        <div aria-busy={notes.isPlaceholderData} className="flex flex-col gap-4">
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('notes.page.list')}>
            {items.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onEdit={(item) => setOpen(item.id)}
                onDelete={setToDelete}
              />
            ))}
          </ul>
          {notes.hasNextPage ? (
            <span className="flex justify-center">
              <AdminButton
                disabled={notes.isFetchingNextPage}
                onClick={() => void notes.fetchNextPage()}
              >
                {notes.isFetchingNextPage ? t('common.loading') : t('notes.page.more')}
              </AdminButton>
            </span>
          ) : null}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {notes.isPlaceholderData ? '' : t('notes.page.count', { count: items.length })}
      </p>
      {dialogs}
    </>
  );
}

/**
 * `/anotacoes`: o caderno do aluno (spec 016, "Página Anotações"): todas as notas, da alteração
 * mais recente à mais antiga, de 30 em 30, com filtro por tipo e por curso, busca, link de volta
 * para a aula e a escrita de notas avulsas.
 */
export function NotesPage() {
  const { t } = useTranslation();
  usePageMeta(t('menu.items.notes'), t('notes.page.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
          <NotesContent />
        </div>
      )}
    </RequireSession>
  );
}
