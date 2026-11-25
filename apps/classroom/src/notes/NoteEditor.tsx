import { AdminButton, AdminField, AdminTextArea, ConfirmDialog, Dialog } from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { ErrorAlert } from '../auth/ErrorAlert';
import { formatInstant, NOTE_BODY_MAX, NOTE_TITLE_MAX, type Note, noteName } from './notes';
import { useNoteEditor } from './useNoteEditor';

/** Textos dos erros próprios das notas (spec 016, "Casos de erro"). */
export function noteErrorMessages(t: TFunction): Record<string, string> {
  return {
    note_empty: t('notes.errors.empty'),
    note_too_long: t('notes.errors.tooLong'),
    note_limit_reached: t('notes.errors.limit'),
    note_lesson_limit_reached: t('notes.errors.lessonLimit'),
    note_video_seconds_invalid: t('notes.errors.videoSeconds'),
    access_denied: t('notes.errors.accessDenied'),
    version_conflict: t('notes.conflict.text'),
  };
}

interface NoteEditorProps {
  /** A nota em edição; `null` começa uma nota nova. */
  initial: Note | null;
  /** Aula da nota nova (aba "Minhas notas"); sem ela a nota nova é avulsa. */
  lessonId?: string | undefined;
  /** Posição atual do player, lida quando o aluno começa a escrever uma nota nova. */
  getVideoSeconds?: (() => number | null) | undefined;
  /** Rótulo do campo de texto. */
  label: string;
  /** Mostra o campo de título (página "Anotações"). */
  showTitle?: boolean;
  rows?: number;
  onCreated?: ((note: Note) => void) | undefined;
  onDeleted?: ((id: string) => void) | undefined;
  /** Botões ao lado do indicador de salvamento; recebem a nota já criada, se houver. */
  actions?: ((note: Note | null) => ReactNode) | undefined;
}

/**
 * Editor de uma nota com salvamento automático, indicador "salvando…/salvo", aviso de erro que
 * mantém o texto, a escolha de versão no conflito e a pergunta de exclusão ao esvaziar a nota.
 */
export function NoteEditor({
  initial,
  lessonId,
  getVideoSeconds,
  label,
  showTitle = false,
  rows = 4,
  onCreated,
  onDeleted,
  actions,
}: NoteEditorProps) {
  const { t } = useTranslation();
  const editor = useNoteEditor({ initial, lessonId, onCreated, onDeleted });
  const { note, draft, state, conflict } = editor;
  const messages = noteErrorMessages(t);
  const ofLesson = note ? note.lesson !== null : lessonId !== undefined;

  const onBody = (body: string) => {
    // nota nova de aula: o instante é o do momento em que o aluno começa a escrever
    const starting = !note && draft.body === '' && draft.videoSeconds === null;
    const seconds = starting && lessonId ? (getVideoSeconds?.() ?? null) : null;
    editor.change(seconds !== null ? { body, videoSeconds: Math.floor(seconds) } : { body });
  };

  const statusText =
    state === 'saving'
      ? t('notes.editor.saving')
      : state === 'saved'
        ? t('notes.editor.saved')
        : state === 'dirty'
          ? t('notes.editor.unsaved')
          : state === 'error'
            ? t('notes.editor.notSaved')
            : '';

  return (
    <div className="flex flex-col gap-3">
      {showTitle ? (
        <AdminField
          label={t('notes.editor.title')}
          value={draft.title}
          maxLength={NOTE_TITLE_MAX}
          onChange={(title: string) => editor.change({ title })}
          onBlur={() => void editor.flush()}
        />
      ) : null}
      <AdminTextArea
        label={label}
        value={draft.body}
        rows={rows}
        maxLength={NOTE_BODY_MAX}
        hint={t('notes.editor.hint')}
        counter={({ length, max }) => t('notes.editor.counter', { length, max })}
        onChange={onBody}
        onBlur={() => void editor.flush()}
      />
      {ofLesson && draft.videoSeconds !== null ? (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <span className="inline-flex items-center gap-1">
            <Clock size={14} aria-hidden="true" />
            {t('notes.instant.at', { time: formatInstant(draft.videoSeconds) })}
          </span>
          <AdminButton
            variant="ghost"
            size="sm"
            onClick={() => {
              editor.change({ videoSeconds: null });
              void editor.flush();
            }}
          >
            {t('notes.instant.remove')}
          </AdminButton>
        </p>
      ) : null}
      <ErrorAlert
        error={editor.error ? describeError(t, editor.error, messages) : null}
        title={t('notes.editor.errorTitle')}
        actions={
          <AdminButton onClick={() => void editor.flush()}>{t('notes.editor.retry')}</AdminButton>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="m-0 min-h-5 text-sm text-ink-3">
          {statusText}
        </p>
        {actions ? <span className="flex flex-wrap gap-2">{actions(note)}</span> : null}
      </div>

      <Dialog
        open={conflict !== null}
        onClose={() => {}}
        dismissible={false}
        role="alertdialog"
        title={t('notes.conflict.title')}
        description={t('notes.conflict.text')}
        footer={
          <>
            <AdminButton disabled={editor.resolving} onClick={() => void editor.resolve('server')}>
              {t('notes.conflict.useServer')}
            </AdminButton>
            <AdminButton disabled={editor.resolving} onClick={() => void editor.resolve('copy')}>
              {editor.resolving ? t('notes.conflict.copying') : t('notes.conflict.copy')}
            </AdminButton>
            <AdminButton
              variant="primary"
              disabled={editor.resolving}
              onClick={() => void editor.resolve('local')}
            >
              {t('notes.conflict.keepLocal')}
            </AdminButton>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-ink">
          <ErrorAlert
            error={editor.copyError ? describeError(t, editor.copyError, messages) : null}
            title={t('notes.conflict.copyErrorTitle')}
          />
          <section className="flex flex-col gap-1" aria-labelledby="note-conflict-local">
            <h3 id="note-conflict-local" className="m-0 text-sm font-semibold">
              {t('notes.conflict.local')}
            </h3>
            <p className="m-0 whitespace-pre-wrap break-words text-ink-2">{draft.body}</p>
          </section>
          <section className="flex flex-col gap-1" aria-labelledby="note-conflict-server">
            <h3 id="note-conflict-server" className="m-0 text-sm font-semibold">
              {t('notes.conflict.server')}
            </h3>
            <p className="m-0 whitespace-pre-wrap break-words text-ink-2">{conflict?.body}</p>
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        open={editor.askDelete}
        onCancel={editor.keepNote}
        onConfirm={() => void editor.remove()}
        title={t('notes.emptied.title')}
        itemName={note ? noteName(note) : ''}
        message={t('notes.emptied.text')}
        confirmLabel={t('notes.delete.confirm')}
        cancelLabel={t('notes.emptied.keep')}
        busy={editor.deleting}
        busyLabel={t('notes.delete.deleting')}
      />
    </div>
  );
}
