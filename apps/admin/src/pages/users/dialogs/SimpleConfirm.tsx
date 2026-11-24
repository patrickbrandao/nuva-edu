import { ConfirmDialog, useToast } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import { useUserActionError } from '../errors';

interface Props {
  title: string;
  itemName: string;
  message: string;
  confirmLabel: string;
  busyLabel: string;
  destructive?: boolean;
  /** A chamada à API; o que ela devolve vai para `onDone`. */
  action: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}

/** Confirmação de uma ação sem formulário (reativar, encerrar sessões). Recusa vira aviso. */
export function SimpleConfirm({ action, onClose, onDone, destructive = true, ...text }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const message = useUserActionError();
  const run = useAction(action);

  const onConfirm = async () => {
    const result = await run.run();
    if (result.ok) onDone();
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
