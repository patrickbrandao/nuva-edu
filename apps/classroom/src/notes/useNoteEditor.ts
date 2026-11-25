import { isApiError } from '@nuva-edu/api-client/classroom';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/client';
import { useSession } from '../session/session';
import { AUTOSAVE_MS, cleanTitle, conflictVersion, dropNote, type Note, storeNote } from './notes';

/** O que o aluno está escrevendo. */
export interface NoteDraft {
  title: string;
  body: string;
  /** Instante do vídeo; só em nota de aula. */
  videoSeconds: number | null;
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type ConflictChoice = 'local' | 'server' | 'copy';

interface Options {
  /** A nota em edição; `null` é nota nova, criada na primeira gravação. */
  initial: Note | null;
  /** Aula da nota nova; sem ela, a nota nova é avulsa. */
  lessonId?: string | undefined;
  onCreated?: ((note: Note) => void) | undefined;
  onDeleted?: ((id: string) => void) | undefined;
}

const toDraft = (note: Note | null): NoteDraft => ({
  title: note?.title ?? '',
  body: note?.body ?? '',
  videoSeconds: note?.videoSeconds ?? null,
});

const sameDraft = (a: NoteDraft, b: NoteDraft) =>
  cleanTitle(a.title) === cleanTitle(b.title) &&
  a.body === b.body &&
  a.videoSeconds === b.videoSeconds;

/**
 * Edição de uma nota com salvamento automático (spec 016, "Edição"): grava 2 s depois da última
 * tecla, ao sair do campo (`flush`) e ao fechar o editor. As gravações saem uma de cada vez e
 * cada uma leva o `updatedAt` da última resposta; `409 version_conflict` para o salvamento até o
 * aluno escolher entre a versão local, a do servidor ou copiar a local para uma nota nova. Em
 * qualquer erro o texto digitado continua no campo.
 */
export function useNoteEditor({ initial, lessonId, onCreated, onDeleted }: Options) {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [note, setNote] = useState<Note | null>(initial);
  const [draft, setDraft] = useState<NoteDraft>(() => toDraft(initial));
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [resolving, setResolving] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // a verdade para o que roda fora do render: gravações em andamento e o fechamento do editor
  const live = useRef({
    note: initial,
    draft: toDraft(initial),
    /** O rascunho como foi gravado pela última vez. */
    saved: toDraft(initial),
    saving: false,
    queued: false,
    conflict: false,
    mounted: true,
  });
  const timer = useRef<number | undefined>(undefined);
  const callbacks = useRef({ onCreated, onDeleted });
  callbacks.current = { onCreated, onDeleted };

  const create = useCallback(
    async (content: NoteDraft, forLesson: string | undefined): Promise<Note> => {
      const title = cleanTitle(content.title);
      const { data } = await api.POST('/api/v1/notes', {
        body: {
          body: content.body,
          ...(title ? { title } : {}),
          // o instante só existe em nota de aula, e sempre inteiro
          ...(forLesson
            ? {
                lessonId: forLesson,
                ...(content.videoSeconds !== null
                  ? { videoSeconds: Math.floor(content.videoSeconds) }
                  : {}),
              }
            : {}),
        },
      });
      if (!data) throw new Error('POST /api/v1/notes respondeu sem corpo');
      return data;
    },
    [api],
  );

  const adopt = useCallback(
    (saved: Note, sent: NoteDraft) => {
      const s = live.current;
      s.note = saved;
      s.saved = sent;
      storeNote(client, userId, saved);
      if (s.mounted) setNote(saved);
    },
    [client, userId],
  );

  const save = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current);
    const s = live.current;
    if (s.conflict) return;
    if (s.saving) {
      s.queued = true;
      return;
    }
    const current = s.note;
    const sent = s.draft;
    if (sent.body.trim() === '') {
      // nota vazia não é gravada; esvaziar uma nota existente pergunta se é para excluir
      if (s.mounted) {
        if (current) setAskDelete(true);
        else setState('idle');
      }
      return;
    }
    if (current && sameDraft(s.saved, sent)) {
      if (s.mounted) setState((value) => (value === 'dirty' ? 'saved' : value));
      return;
    }
    s.saving = true;
    if (s.mounted) setState('saving');
    try {
      let saved: Note;
      if (current) {
        const title = cleanTitle(sent.title);
        const { data } = await api.PATCH('/api/v1/notes/{id}', {
          params: { path: { id: current.id } },
          body: {
            ...(title !== cleanTitle(s.saved.title) ? { title } : {}),
            ...(sent.body !== s.saved.body ? { body: sent.body } : {}),
            ...(current.lesson && sent.videoSeconds !== s.saved.videoSeconds
              ? { videoSeconds: sent.videoSeconds }
              : {}),
            // sempre o da última resposta: é ele que o servidor compara
            updatedAt: current.updatedAt,
          },
        });
        if (!data) throw new Error('PATCH /api/v1/notes/{id} respondeu sem corpo');
        saved = data;
      } else {
        saved = await create(sent, lessonId);
      }
      adopt(saved, sent);
      // editor já fechado: a nota chega às listas pelo cache, sem avisar a tela
      if (!current && s.mounted) callbacks.current.onCreated?.(saved);
      if (s.mounted) {
        setError(null);
        setState(sameDraft(sent, s.draft) ? 'saved' : 'dirty');
      }
    } catch (failure) {
      s.queued = false;
      const version = conflictVersion(failure);
      if (version) s.conflict = true;
      if (s.mounted) {
        if (version) setConflict(version);
        else setError(failure);
        setState('error');
      }
    } finally {
      s.saving = false;
      if (s.queued) {
        s.queued = false;
        void save();
      }
    }
  }, [api, adopt, create, lessonId]);

  const change = useCallback(
    (patch: Partial<NoteDraft>) => {
      const s = live.current;
      s.draft = { ...s.draft, ...patch };
      setDraft(s.draft);
      setState('dirty');
      setError(null);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    },
    [save],
  );

  // fechar o editor grava o que faltava (a resposta ainda atualiza as listas em cache)
  useEffect(() => {
    const s = live.current;
    s.mounted = true;
    return () => {
      s.mounted = false;
      window.clearTimeout(timer.current);
      if (s.draft.body.trim() !== '' && !sameDraft(s.saved, s.draft)) void save();
    };
  }, [save]);

  const takeServer = useCallback(
    (version: Note) => {
      const s = live.current;
      s.conflict = false;
      s.draft = toDraft(version);
      adopt(version, s.draft);
      setDraft(s.draft);
      setConflict(null);
      setCopyError(null);
      setError(null);
      setState('saved');
    },
    [adopt],
  );

  /** Resolve o conflito de edição com a escolha do aluno. */
  const resolve = useCallback(
    async (choice: ConflictChoice): Promise<void> => {
      const s = live.current;
      const version = conflict;
      if (!version || resolving) return;
      if (choice === 'server') {
        takeServer(version);
        return;
      }
      if (choice === 'local') {
        // grava a local por cima da versão atual; outro `409` reabre a escolha
        s.conflict = false;
        s.note = version;
        s.saved = toDraft(version);
        setNote(version);
        setConflict(null);
        setCopyError(null);
        await save();
        return;
      }
      setResolving(true);
      setCopyError(null);
      const local = s.draft;
      const lesson = version.lesson?.available ? (version.lesson.id ?? undefined) : undefined;
      try {
        let copy: Note;
        try {
          copy = await create(local, lesson);
        } catch (failure) {
          // sem acesso à aula (ou aula indisponível), a cópia vira nota avulsa
          const refused =
            lesson !== undefined &&
            isApiError(failure) &&
            (failure.status === 403 || failure.status === 404);
          if (!refused) throw failure;
          copy = await create(local, undefined);
        }
        storeNote(client, userId, copy);
        if (s.mounted) {
          callbacks.current.onCreated?.(copy);
          takeServer(version);
        }
      } catch (failure) {
        // limite de notas e outros erros: a escolha continua aberta e o texto local, guardado
        if (s.mounted) setCopyError(failure);
      } finally {
        if (s.mounted) setResolving(false);
      }
    },
    [conflict, resolving, takeServer, save, create, client, userId],
  );

  /** Exclui a nota em edição (definitivo). */
  const remove = useCallback(async (): Promise<boolean> => {
    const s = live.current;
    const current = s.note;
    if (!current) return false;
    setDeleting(true);
    try {
      await deleteNote(api, current.id);
      // nada mais a gravar ao fechar
      s.draft = s.saved;
      dropNote(client, userId, current.id);
      callbacks.current.onDeleted?.(current.id);
      return true;
    } catch (failure) {
      if (s.mounted) {
        setError(failure);
        setState('error');
      }
      return false;
    } finally {
      if (s.mounted) {
        setDeleting(false);
        setAskDelete(false);
      }
    }
  }, [api, client, userId]);

  /** Desiste de excluir a nota esvaziada: o texto gravado volta ao campo. */
  const keepNote = useCallback(() => {
    const s = live.current;
    s.draft = { ...s.draft, body: s.saved.body };
    setDraft(s.draft);
    setAskDelete(false);
    setState(sameDraft(s.saved, s.draft) ? 'saved' : 'dirty');
  }, []);

  return {
    note,
    draft,
    state,
    error,
    conflict,
    copyError,
    resolving,
    askDelete,
    deleting,
    change,
    flush: save,
    resolve,
    remove,
    keepNote,
  };
}

/** `DELETE /api/v1/notes/{id}`; nota que já não existe (`404`) conta como excluída. */
export async function deleteNote(api: ReturnType<typeof useApi>, id: string): Promise<void> {
  try {
    await api.DELETE('/api/v1/notes/{id}', { params: { path: { id } } });
  } catch (error) {
    if (isApiError(error) && error.status === 404 && error.code !== 'unknown_error') return;
    throw error;
  }
}
