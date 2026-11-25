import { ConfirmDialog, useToast } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError } from '../api/errors';
import { useSession } from '../session/session';
import { dropNote, noteName } from './notes';
import { deleteNote } from './useNoteEditor';

interface Target {
  id: string;
  title: string | null;
  body?: string;
  excerpt?: string;
}

/** Confirmação de exclusão de uma nota (definitiva, sem lixeira), citando a nota. */
export function DeleteNoteDialog({ note, onClose }: { note: Target | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [deleting, setDeleting] = useState(false);

  const confirm = async () => {
    if (!note) return;
    setDeleting(true);
    try {
      await deleteNote(api, note.id);
      dropNote(client, userId, note.id);
      toast.success(t('notes.delete.done'));
    } catch (error) {
      toast.error(describeError(t, error).message, { title: t('notes.delete.errorTitle') });
    } finally {
      setDeleting(false);
      onClose();
    }
  };

  return (
    <ConfirmDialog
      open={note !== null}
      onCancel={onClose}
      onConfirm={() => void confirm()}
      title={t('notes.delete.title')}
      itemName={note ? noteName(note) : ''}
      message={t('notes.delete.text')}
      confirmLabel={t('notes.delete.confirm')}
      cancelLabel={t('common.cancel')}
      busy={deleting}
      busyLabel={t('notes.delete.deleting')}
    />
  );
}
