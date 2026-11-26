import {
  AdminButton,
  AdminStatus,
  AdminTag,
  Alert,
  ConfirmDialog,
  type SortableListLabels,
  useToast,
} from '@nuva-edu/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import type { CourseSummary } from '../../api/courses';
import { useCourseError } from './errors';

type Publication = Pick<CourseSummary, 'status' | 'archivedAt' | 'reviewRequestedAt'>;

/** Situação do curso: arquivado, publicado ou rascunho; pedido de publicação como etiqueta. */
export function CourseStatusCell({ course }: { course: Publication }) {
  const { t } = useTranslation();
  const state = course.archivedAt ? 'archived' : course.status;
  const tone = state === 'published' ? 'green' : state === 'archived' ? 'red' : 'gray';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AdminStatus tone={tone}>{t(`courses.status.${state}`)}</AdminStatus>
      {course.reviewRequestedAt && !course.archivedAt ? (
        <AdminTag>{t('courses.awaitingReview')}</AdminTag>
      ) : null}
    </span>
  );
}

/** Textos da lista reordenável (alça, instruções e anúncios), das traduções do site. */
export function useSortableLabels(): SortableListLabels {
  const { t } = useTranslation();
  return {
    instructions: t('courses.sortable.instructions'),
    roleDescription: t('courses.sortable.roleDescription'),
    handle: (label) => t('courses.sortable.handle', { label }),
    pickedUp: (label, position, total) =>
      t('courses.sortable.pickedUp', { label, position, total }),
    movedTo: (label, position, total) => t('courses.sortable.movedTo', { label, position, total }),
    dropped: (label, position, total) => t('courses.sortable.dropped', { label, position, total }),
    cancelled: (label, position, total) =>
      t('courses.sortable.cancelled', { label, position, total }),
  };
}

interface ConfirmActionProps<R> {
  title: string;
  itemName: string;
  message: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  destructive?: boolean;
  /** A chamada à API; o que ela devolve vai para `onDone`. */
  action: () => Promise<R>;
  onClose: () => void;
  onDone: (result: R) => void;
  /** Texto da recusa; por padrão, o do editor de curso. */
  describeError?: ((error: unknown) => string) | undefined;
  /** Recusa tratada por quem abriu (ex.: o conflito de edição); sem ele, a recusa vira aviso. */
  onError?: ((error: unknown) => void) | undefined;
}

/** Confirmação de uma ação do catálogo sem formulário. A recusa da API vira aviso. */
export function ConfirmAction<R>({
  action,
  onClose,
  onDone,
  destructive = false,
  describeError,
  onError,
  ...text
}: ConfirmActionProps<R>) {
  const { t } = useTranslation();
  const toast = useToast();
  const courseMessage = useCourseError();
  const message = describeError ?? courseMessage;
  const run = useAction(action);

  const onConfirm = async () => {
    const result = await run.run();
    if (result.ok) onDone(result.data);
    else if (onError) onError(result.error);
    else toast.error(message(result.error), { title: text.title });
    onClose();
  };

  return (
    <ConfirmDialog
      open
      onCancel={onClose}
      onConfirm={() => void onConfirm()}
      title={text.title}
      itemName={text.itemName}
      message={text.message}
      confirmLabel={text.confirmLabel}
      cancelLabel={t('common.cancel')}
      busy={run.busy}
      busyLabel={text.busyLabel}
      destructive={destructive}
    />
  );
}

/**
 * Aviso do `409` `version_conflict` (spec 009, "Criação e edição"): outra pessoa gravou o item
 * no meio da edição. Nada foi gravado, o que foi digitado continua na tela, e "Recarregar" traz
 * a versão atual; salvar de novo fica com a pessoa.
 */
export function ConflictAlert({
  onReload,
  className,
}: {
  /** Lê o item de novo; o aviso some quando a leitura termina. */
  onReload: () => Promise<unknown>;
  className?: string;
}) {
  const { t } = useTranslation();
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setReloading(true);
    try {
      await onReload();
    } finally {
      setReloading(false);
    }
  };
  return (
    <Alert
      tone="warning"
      role="alert"
      className={className}
      title={t('courses.conflict.title')}
      actions={
        <AdminButton size="sm" disabled={reloading} onClick={() => void reload()}>
          {reloading ? t('courses.conflict.reloading') : t('courses.conflict.reload')}
        </AdminButton>
      }
    >
      {t('courses.conflict.text')}
    </Alert>
  );
}
