import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCheckbox,
  AdminEmpty,
  AdminPageHeader,
  AdminStatus,
  AdminTable,
  AdminTabs,
  AdminTextArea,
  Alert,
  ConfirmDialog,
  Dialog,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState, useProblemText } from '../../api/problems';
import {
  TERMS_DOCUMENTS,
  type TermsDocument,
  type TermsVersionEntry,
  termsKey,
  useTermsVersions,
} from '../../api/terms';
import { formatDateTime } from '../../format';
import { usePageCrumb } from '../../shell/crumbs';

const BODY_MAX = 100_000;

/**
 * Termos de Uso e Política de Privacidade (spec 030, "Termos na Fase 1"; só `settings.manage`):
 * versões de cada documento, novo rascunho (com o texto modelo na primeira versão) e publicação
 * com confirmação. Rascunho não se edita: para mudar o texto, cria-se outro.
 */
export function TermsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const document: TermsDocument =
    TERMS_DOCUMENTS.find((d) => d === params.get('documento')) ?? 'terms';
  const versions = useTermsVersions(document);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<TermsVersionEntry | null>(null);
  usePageCrumb(t('terms.title'));

  const columns = [
    {
      id: 'version',
      label: t('terms.columns.version'),
      render: (entry: TermsVersionEntry) =>
        entry.version === null
          ? t('terms.draft')
          : t('terms.versionNumber', { version: entry.version }),
    },
    {
      id: 'status',
      label: t('terms.columns.status'),
      render: (entry: TermsVersionEntry) => (
        <AdminStatus tone={entry.status === 'published' ? 'green' : 'gray'}>
          {t(`terms.status.${entry.status}`)}
        </AdminStatus>
      ),
    },
    {
      id: 'reacceptance',
      label: t('terms.columns.reacceptance'),
      render: (entry: TermsVersionEntry) =>
        entry.requiresReacceptance ? t('terms.yes') : t('terms.no'),
    },
    {
      id: 'createdAt',
      label: t('terms.columns.createdAt'),
      render: (entry: TermsVersionEntry) => formatDateTime(entry.createdAt),
    },
    {
      id: 'publishedAt',
      label: t('terms.columns.publishedAt'),
      render: (entry: TermsVersionEntry) =>
        entry.publishedAt ? formatDateTime(entry.publishedAt) : '—',
    },
    {
      id: 'actions',
      label: t('terms.columns.actions'),
      render: (entry: TermsVersionEntry) =>
        entry.status === 'draft' ? (
          <AdminButton
            size="sm"
            aria-label={t('terms.publish.openFor', { created: formatDateTime(entry.createdAt) })}
            onClick={() => setPublishing(entry)}
          >
            {t('terms.publish.open')}
          </AdminButton>
        ) : null,
    },
  ];

  const documentName = t(`terms.documents.${document}`);
  const isFirst = versions.data !== undefined && versions.data.length === 0;

  return (
    <>
      <AdminPageHeader
        title={t('terms.title')}
        subtitle={t('terms.subtitle')}
        actions={
          <AdminButton
            variant="primary"
            disabled={!versions.data}
            onClick={() => setCreating(true)}
          >
            {t('terms.create.open')}
          </AdminButton>
        }
      />
      <AdminTabs
        className="mb-4"
        label={t('terms.tabsLabel')}
        tabs={TERMS_DOCUMENTS.map((id) => ({ id, label: t(`terms.documents.${id}`) }))}
        value={document}
        onChange={(id: TermsDocument) =>
          setParams(id === 'terms' ? {} : { documento: id }, { replace: true })
        }
      />
      {versions.isPending ? (
        <LoadingState label={t('terms.loading')} />
      ) : versions.isError && !versions.data ? (
        <QueryErrorState
          error={versions.error}
          title={t('terms.errorTitle')}
          onRetry={() => void versions.refetch()}
          retrying={versions.isFetching}
        />
      ) : (
        <>
          {versions.data.some((entry) => entry.status === 'published') ? null : (
            <Alert
              tone="warning"
              className="mb-4"
              title={t('terms.noPublishedTitle', { document: documentName })}
            >
              {t('terms.noPublishedText')}
            </Alert>
          )}
          <AdminTable
            columns={columns}
            rows={versions.data}
            empty={
              <AdminEmpty
                icon={<FileText aria-hidden="true" />}
                title={t('terms.empty', { document: documentName })}
                text={t('terms.emptyText')}
              >
                <AdminButton onClick={() => setCreating(true)}>
                  {t('terms.create.open')}
                </AdminButton>
              </AdminEmpty>
            }
          />
        </>
      )}

      {creating ? (
        <CreateDraftDialog
          document={document}
          withTemplate={isFirst}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {publishing ? (
        <PublishConfirm
          document={document}
          entry={publishing}
          onClose={() => setPublishing(null)}
        />
      ) : null}
    </>
  );
}

function CreateDraftDialog({
  document,
  withTemplate,
  onClose,
}: {
  document: TermsDocument;
  withTemplate: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const describe = useProblemText();
  const formId = useId();
  const [body, setBody] = useState(withTemplate ? t(`terms.templates.${document}`) : '');
  const [reaccept, setReaccept] = useState(false);
  const [missing, setMissing] = useState(false);

  const create = useAction(async () => {
    const { data } = await api.POST('/api/v1/terms', {
      body: { document, bodyMd: body, requiresReacceptance: reaccept },
    });
    if (!data) throw new Error('POST /api/v1/terms respondeu sem corpo');
    return data;
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = body.trim() === '';
    setMissing(empty);
    if (empty) return;
    const result = await create.run();
    if (result.ok) {
      void queryClient.invalidateQueries({ queryKey: termsKey(document) });
      toast.success(t('terms.create.done'));
      onClose();
    }
  };

  const errorText = (() => {
    if (!create.error) return null;
    if (isApiError(create.error) && create.error.code === 'validation_failed') {
      return t('terms.create.invalid');
    }
    const { text, detail } = describe(create.error);
    return detail ? `${text} ${detail}` : text;
  })();

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={t('terms.create.title', { document: t(`terms.documents.${document}`) })}
      description={withTemplate ? t('terms.create.templateNote') : t('terms.create.note')}
      closeLabel={t('common.close')}
      dismissible={!create.busy}
      footer={
        <>
          <AdminButton disabled={create.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={create.busy}>
            {create.busy ? t('common.saving') : t('terms.create.submit')}
          </AdminButton>
        </>
      }
    >
      {errorText ? (
        <Alert tone="error" className="mb-4">
          {errorText}
        </Alert>
      ) : null}
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminTextArea
          label={t('terms.create.body')}
          counter={({ length, max }) => t('terms.create.bodyCount', { count: length, max })}
          value={body}
          onChange={setBody}
          rows={10}
          maxLength={BODY_MAX}
          error={missing ? t('forms.required') : undefined}
        />
        <AdminCheckbox checked={reaccept} onChange={setReaccept}>
          {t('terms.create.reacceptance')}
        </AdminCheckbox>
      </form>
    </Dialog>
  );
}

function PublishConfirm({
  document,
  entry,
  onClose,
}: {
  document: TermsDocument;
  entry: TermsVersionEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const describe = useProblemText();
  const publish = useAction(async () => {
    const { data } = await api.POST('/api/v1/terms/{id}/publish', {
      params: { path: { id: entry.id } },
    });
    if (!data) throw new Error('POST /api/v1/terms/{id}/publish respondeu sem corpo');
    return data;
  });

  const onConfirm = async () => {
    const result = await publish.run();
    // Com acerto ou com `terms_already_published`, a lista muda: busca de novo.
    void queryClient.invalidateQueries({ queryKey: termsKey(document) });
    if (result.ok) {
      toast.success(
        t('terms.publish.done', {
          version: result.data.version ?? '',
          document: t(`terms.documents.${document}`),
        }),
      );
    } else if (isApiError(result.error) && result.error.code === 'terms_already_published') {
      toast.warning(t('terms.publish.already'));
    } else {
      const { text, detail } = describe(result.error);
      toast.error(detail ? `${text} ${detail}` : text, { title: t('terms.publish.error') });
    }
    onClose();
  };

  return (
    <ConfirmDialog
      open
      onCancel={onClose}
      onConfirm={() => void onConfirm()}
      title={t('terms.publish.confirmTitle')}
      itemName={t('terms.publish.item', {
        document: t(`terms.documents.${document}`),
        created: formatDateTime(entry.createdAt),
      })}
      message={
        entry.requiresReacceptance ? t('terms.publish.textReaccept') : t('terms.publish.text')
      }
      confirmLabel={t('terms.publish.confirm')}
      cancelLabel={t('common.cancel')}
      busy={publish.busy}
      busyLabel={t('terms.publish.busy')}
    />
  );
}
