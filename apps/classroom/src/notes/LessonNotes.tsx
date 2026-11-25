import { AdminButton, ErrorState, LoadingState, Markdown } from '@nuva-edu/ui';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { useDateFormatter } from '../catalog/format';
import { DeleteNoteDialog } from './DeleteNoteDialog';
import { NoteEditor } from './NoteEditor';
import { formatInstant, type Note, noteName, useLessonNotes } from './notes';

interface LessonNotesProps {
  lessonId: string;
  /** Com acesso à aula, o aluno escreve notas novas; sem ele, só lê, edita e exclui as que tem. */
  canCreate: boolean;
  /** Posição atual do player, quando ele a informa. */
  getVideoSeconds?: (() => number | null) | undefined;
  /** Leva o player ao instante; ausente, o instante é só informativo. */
  onSeek?: ((seconds: number) => void) | undefined;
  /** Sem notas e sem poder criar, não mostra nada (tela de "sem acesso"). */
  hideWhenEmpty?: boolean;
}

function NoteItem({
  note,
  onSeek,
  onAskDelete,
}: {
  note: Note;
  onSeek: LessonNotesProps['onSeek'];
  onAskDelete: (note: Note) => void;
}) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const [editing, setEditing] = useState(false);
  const name = noteName(note);

  if (editing) {
    return (
      <li className="rounded-lg border border-solid border-line p-3">
        <NoteEditor
          initial={note}
          label={t('notes.lesson.editLabel')}
          actions={() => (
            <AdminButton onClick={() => setEditing(false)}>{t('notes.editor.done')}</AdminButton>
          )}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-solid border-line p-3">
      {note.title ? <h3 className="m-0 text-sm font-semibold text-ink">{note.title}</h3> : null}
      <Markdown newTabLabel={t('common.newTab')}>{note.body}</Markdown>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm text-ink-3">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {note.videoSeconds !== null ? (
            onSeek ? (
              <AdminButton
                variant="ghost"
                size="sm"
                icon={<Clock size={14} aria-hidden="true" />}
                aria-label={t('notes.instant.goTo', { time: formatInstant(note.videoSeconds) })}
                onClick={() => onSeek(note.videoSeconds ?? 0)}
              >
                {formatInstant(note.videoSeconds)}
              </AdminButton>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden="true" />
                {t('notes.instant.at', { time: formatInstant(note.videoSeconds) })}
              </span>
            )
          ) : null}
          <span>{formatDate(note.updatedAt)}</span>
        </span>
        <span className="flex gap-2">
          <AdminButton
            size="sm"
            aria-label={t('notes.actions.editOf', { name })}
            onClick={() => setEditing(true)}
          >
            {t('notes.actions.edit')}
          </AdminButton>
          <AdminButton
            size="sm"
            variant="ghost"
            aria-label={t('notes.actions.deleteOf', { name })}
            onClick={() => onAskDelete(note)}
          >
            {t('notes.actions.delete')}
          </AdminButton>
        </span>
      </div>
    </li>
  );
}

/**
 * Aba "Minhas notas" da aula (spec 016, "Nota de aula"): todas as notas do aluno na aula, da
 * mais antiga à mais recente (no máximo 100, sem paginação), e o campo para escrever outra. A
 * nota nova nasce na primeira gravação automática e segue no campo até o aluno concluí-la.
 */
export function LessonNotes({
  lessonId,
  canCreate,
  getVideoSeconds,
  onSeek,
  hideWhenEmpty = false,
}: LessonNotesProps) {
  const { t } = useTranslation();
  const query = useLessonNotes(lessonId);
  // a nota que está no campo de escrever, e a vez do campo (cada nota nova, um campo novo)
  const [composing, setComposing] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [toDelete, setToDelete] = useState<Note | null>(null);

  const nextNote = () => {
    setComposing(null);
    setTurn((value) => value + 1);
  };

  if (query.isPending) {
    return hideWhenEmpty ? null : <LoadingState label={t('notes.lesson.loading')} />;
  }
  if (query.isError) {
    if (hideWhenEmpty) return null;
    const failure = describeError(t, query.error);
    return (
      <ErrorState
        title={t('notes.lesson.errorTitle')}
        text={failure.message}
        detail={failure.detail}
        retryLabel={t('common.retry')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const notes = query.data.filter((note) => note.id !== composing);
  if (hideWhenEmpty && notes.length === 0 && !canCreate) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`lesson-notes-${lessonId}`}>
      <h2
        id={`lesson-notes-${lessonId}`}
        className={hideWhenEmpty ? 'm-0 text-base font-semibold text-ink' : 'sr-only'}
      >
        {t('notes.lesson.title')}
      </h2>
      {notes.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('notes.lesson.list')}>
          {notes.map((note) => (
            <NoteItem key={note.id} note={note} onSeek={onSeek} onAskDelete={setToDelete} />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-ink-3">{t('notes.lesson.empty')}</p>
      )}
      {canCreate ? (
        <NoteEditor
          key={turn}
          initial={null}
          lessonId={lessonId}
          getVideoSeconds={getVideoSeconds}
          label={t('notes.lesson.newLabel')}
          onCreated={(note) => setComposing((current) => current ?? note.id)}
          onDeleted={nextNote}
          actions={(note) =>
            note ? <AdminButton onClick={nextNote}>{t('notes.lesson.finish')}</AdminButton> : null
          }
        />
      ) : null}

      <DeleteNoteDialog note={toDelete} onClose={() => setToDelete(null)} />
    </section>
  );
}
