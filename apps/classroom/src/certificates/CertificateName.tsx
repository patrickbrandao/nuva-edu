import { AdminButton, AdminField, Dialog, useToast } from '@nuva-edu/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, fieldErrors } from '../api/errors';
import { ErrorAlert } from '../auth/ErrorAlert';
import { CERTIFICATE_NAME_MAX, useCertificateName } from './certificates';

interface NameDialogProps {
  open: boolean;
  /** O nome que sai hoje: começa no campo. */
  current: string;
  onClose: () => void;
}

/**
 * Diálogo "Nome no certificado": grava o nome completo (`PUT /me/certificate-name`), sem prazo de
 * confirmação (ADR 0026). Campo vazio apaga o nome, e passa a valer o nome de exibição.
 */
function NameDialog({ open, current, onClose }: NameDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useCertificateName();
  const [value, setValue] = useState(current);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fullName = value.trim();
    save.mutate(fullName === '' ? null : fullName, {
      onSuccess: () => {
        toast.success(t('certificates.name.saved'));
        onClose();
      },
    });
  };

  const fieldError = save.error ? fieldErrors(save.error).fullName : undefined;
  const failure =
    save.error && !fieldError
      ? describeError(t, save.error, {
          payload_too_large: t('certificates.name.tooLong', { max: CERTIFICATE_NAME_MAX }),
        })
      : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!save.isPending}
      title={t('certificates.name.dialogTitle')}
      description={t('certificates.name.dialogText')}
      closeLabel={t('common.cancel')}
      size="sm"
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AdminField
          label={t('certificates.name.field')}
          hint={t('certificates.name.hint')}
          error={
            fieldError ? t('certificates.name.tooLong', { max: CERTIFICATE_NAME_MAX }) : undefined
          }
          value={value}
          maxLength={CERTIFICATE_NAME_MAX}
          autoComplete="name"
          onChange={setValue}
        />
        <ErrorAlert error={failure} title={t('certificates.name.errorTitle')} />
        <div className="flex flex-wrap justify-end gap-2">
          <AdminButton type="button" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t('certificates.name.saving') : t('certificates.name.save')}
          </AdminButton>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * O nome que sairá no certificado, com "Alterar" (spec 015, "Nome no certificado"). Fica na página
 * do curso, enquanto o curso está em andamento, e na seção Certificados.
 */
export function CertificateName({ name, label }: { name: string; label: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="m-0 flex min-w-0 flex-col text-sm">
        <span className="text-ink-3">{label}</span>
        <span className="break-words font-semibold text-ink">{name}</span>
      </p>
      <AdminButton
        size="sm"
        onClick={() => setOpen(true)}
        // o nome lido começa pelo texto visível (WCAG 2.5.3)
        aria-label={t('certificates.name.changeLabel')}
      >
        {t('certificates.name.change')}
      </AdminButton>
      {open ? <NameDialog open current={name} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
