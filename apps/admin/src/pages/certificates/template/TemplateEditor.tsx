import {
  AdminButton,
  AdminCard,
  AdminSection,
  Alert,
  ConfirmDialog,
  LoadingState,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, ImagePlus, Sparkles } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../../api/action';
import {
  type CertificateTemplate,
  type CertificateTemplateProblem,
  offsetOf,
  previewPdfPath,
  TEMPLATE_IMAGE_TYPES,
  TEMPLATE_MAX_BYTES,
  TEMPLATE_PROBLEMS_MAX,
  type TemplateScope,
  templateKeys,
  templatePreviewInput,
  templateProblems,
  templatesChanged,
  useCertificatePreview,
  useCertificateTemplate,
  useTemplateReference,
  utf8Bytes,
} from '../../../api/certificateTemplates';
import { useApi } from '../../../api/client';
import { QueryErrorState } from '../../../api/problems';
import { formatDateTime } from '../../../format';
import { ConfirmAction } from '../../courses/CourseBits';
import { CodeEditor, moveCaret } from './CodeEditor';
import { isVersionConflict, useTemplateError } from './errors';
import { KeywordList } from './KeywordList';

/**
 * Editor do template do certificado (spec 015, "Template" e "Pré-visualização"; ADR 0026), o
 * mesmo para o template do curso (aba do editor de curso) e para o padrão da escola
 * (`/configuracoes`). Esconder a tela não é permissão: a API confere cada chamada.
 */
export function TemplateEditor({ scope }: { scope: TemplateScope }) {
  const { t } = useTranslation();
  const template = useCertificateTemplate(scope);
  const title = t(`certificateTemplate.title.${scope.kind}`);

  return (
    <AdminSection title={title}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">
        {t(`certificateTemplate.intro.${scope.kind}`)}
      </p>
      {template.isPending ? (
        <LoadingState label={t('certificateTemplate.loading')} />
      ) : template.isError && !template.data ? (
        <QueryErrorState
          error={template.error}
          title={t('certificateTemplate.errorTitle')}
          onRetry={() => void template.refetch()}
          retrying={template.isFetching}
        />
      ) : (
        <TemplateForm
          key={templateKeys.of(scope).join('/')}
          scope={scope}
          template={template.data}
          reload={async () => (await template.refetch()).data}
        />
      )}
    </AdminSection>
  );
}

type Confirm = 'delete' | 'model' | null;

const KIB = 1024;
const formatKib = (bytes: number, language: string) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / KIB);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface TemplateFormProps {
  scope: TemplateScope;
  template: CertificateTemplate;
  /** Lê o template de novo (depois de um `409`). */
  reload: () => Promise<CertificateTemplate | undefined>;
}

function TemplateForm({ scope, template, reload }: TemplateFormProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useTemplateError();
  const reference = useTemplateReference();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // o que está gravado: muda ao salvar, excluir ou recarregar; o editor guarda o texto à parte
  const [baseline, setBaseline] = useState(template);
  const [html, setHtml] = useState(template.html ?? '');
  const [problems, setProblems] = useState<CertificateTemplateProblem[] | null>(null);
  const [conflict, setConflict] = useState(false);
  const [backfill, setBackfill] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const bytes = utf8Bytes(html);
  const tooLarge = bytes > TEMPLATE_MAX_BYTES;
  const dirty = html !== (baseline.html ?? '');
  const empty = html.trim() === '';

  const goTo = (problem: CertificateTemplateProblem) => {
    if (textarea.current) {
      moveCaret(textarea.current, offsetOf(html, problem.line, problem.column), problem.line);
    }
  };

  const showProblems = (found: CertificateTemplateProblem[]) => {
    setProblems(found);
    const first = found[0];
    // o cursor vai ao primeiro problema; a lista fica logo acima, para os demais
    if (first && textarea.current) {
      moveCaret(textarea.current, offsetOf(html, first.line, first.column), first.line);
    }
  };

  const save = useAction(async () => {
    const body = { html, expectedVersionId: baseline.versionId };
    const { data } =
      scope.kind === 'course'
        ? await api.PUT('/api/v1/courses/{id}/certificate-template', {
            params: { path: { id: scope.courseId } },
            body,
          })
        : await api.PUT('/api/v1/settings/certificate-template', { body });
    if (!data) throw new Error('PUT do template do certificado respondeu sem corpo');
    return data;
  });

  const onSave = async () => {
    setProblems(null);
    setConflict(false);
    setBackfill(false);
    const result = await save.run();
    if (!result.ok) {
      const found = templateProblems(result.error);
      if (found) showProblems(found);
      else if (isVersionConflict(result.error)) setConflict(true);
      return;
    }
    const { backfillQueued, ...saved } = result.data;
    setBaseline(saved);
    setHtml(saved.html);
    setBackfill(backfillQueued);
    void templatesChanged(queryClient);
    toast.success(t('certificateTemplate.saved'));
  };

  const onReload = async () => {
    setReloading(true);
    try {
      const fresh = await reload();
      if (!fresh) return;
      setBaseline(fresh);
      setHtml(fresh.html ?? '');
      setConflict(false);
      setProblems(null);
      save.reset();
    } finally {
      setReloading(false);
    }
  };

  const requestPreview = useAction(async () => {
    const { data } = await api.POST('/api/v1/certificate-templates/previews', {
      body: templatePreviewInput(html, scope),
    });
    if (!data) throw new Error('POST /api/v1/certificate-templates/previews respondeu sem corpo');
    return data;
  });
  const preview = useCertificatePreview(previewId);
  const opened = useRef<string | null>(null);
  const previewStatus = previewId ? preview.data?.status : undefined;
  const previewBusy = requestPreview.busy || (previewId !== null && previewStatus === 'pending');
  // pronto: abre o PDF numa aba nova uma vez; o link fica na tela, caso o navegador bloqueie
  useEffect(() => {
    if (previewId && previewStatus === 'ready' && opened.current !== previewId) {
      opened.current = previewId;
      window.open(previewPdfPath(previewId), '_blank', 'noopener');
    }
  }, [previewId, previewStatus]);

  const onPreview = async () => {
    setProblems(null);
    setPreviewId(null);
    const result = await requestPreview.run();
    if (result.ok) {
      setPreviewId(result.data.id);
      return;
    }
    const found = templateProblems(result.error);
    if (found) showProblems(found);
  };

  const applyModel = () => {
    if (!reference.data) return;
    setHtml(reference.data.modelHtml);
    setConfirm(null);
    textarea.current?.focus();
  };

  const onImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setImageError(null);
    if (!(TEMPLATE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setImageError(t('certificateTemplate.image.type'));
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      setImageError(t('certificateTemplate.image.readFailed'));
      return;
    }
    const snippet = `<img src="${dataUrl}" alt="">`;
    const box = textarea.current;
    const start = box ? box.selectionStart : html.length;
    const end = box ? box.selectionEnd : html.length;
    const next = html.slice(0, start) + snippet + html.slice(end);
    const nextBytes = utf8Bytes(next);
    if (nextBytes > TEMPLATE_MAX_BYTES) {
      setImageError(
        t('certificateTemplate.image.tooLarge', {
          size: formatKib(nextBytes, i18n.language),
          max: formatKib(TEMPLATE_MAX_BYTES, i18n.language),
        }),
      );
      return;
    }
    setHtml(next);
    toast.success(t('certificateTemplate.image.inserted', { name: file.name }));
    requestAnimationFrame(() => {
      if (box) {
        box.focus();
        box.setSelectionRange(start + snippet.length, start + snippet.length);
      }
    });
  };

  const sourceTone = baseline.source === 'none' ? 'warning' : 'info';
  const saveError =
    save.error && !templateProblems(save.error) && !isVersionConflict(save.error)
      ? message(save.error)
      : null;
  const previewError =
    requestPreview.error && !templateProblems(requestPreview.error)
      ? message(requestPreview.error)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Alert tone={sourceTone} title={t(`certificateTemplate.source.${baseline.source}`)}>
        {t(`certificateTemplate.sourceText.${scope.kind}.${baseline.source}`)}
        {baseline.updatedAt ? (
          <span className="mt-1 block text-sm text-ink-3">
            {baseline.updatedBy
              ? t('certificateTemplate.updatedBy', {
                  name: baseline.updatedBy.name,
                  date: formatDateTime(baseline.updatedAt),
                })
              : t('certificateTemplate.updatedAt', { date: formatDateTime(baseline.updatedAt) })}
          </span>
        ) : null}
      </Alert>

      {backfill ? (
        <Alert
          tone="success"
          title={t('certificateTemplate.backfill.title')}
          onDismiss={() => setBackfill(false)}
          dismissLabel={t('common.dismiss')}
        >
          {t('certificateTemplate.backfill.text')}
        </Alert>
      ) : null}
      {conflict ? (
        <Alert
          tone="warning"
          role="alert"
          title={t('certificateTemplate.conflict.title')}
          actions={
            <AdminButton disabled={reloading} onClick={() => void onReload()}>
              {reloading
                ? t('certificateTemplate.conflict.reloading')
                : t('certificateTemplate.conflict.reload')}
            </AdminButton>
          }
        >
          {t('certificateTemplate.conflict.text')}
        </Alert>
      ) : null}
      {saveError ? <Alert tone="error">{saveError}</Alert> : null}
      {problems ? <ProblemList problems={problems} onSelect={goTo} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <AdminButton
              icon={<Sparkles size={16} aria-hidden="true" />}
              disabled={!reference.data}
              onClick={() => (empty ? applyModel() : setConfirm('model'))}
            >
              {t('certificateTemplate.model.open')}
            </AdminButton>
            <AdminButton
              icon={<ImagePlus size={16} aria-hidden="true" />}
              onClick={() => fileInput.current?.click()}
            >
              {t('certificateTemplate.image.open')}
            </AdminButton>
            <input
              ref={fileInput}
              type="file"
              hidden
              tabIndex={-1}
              aria-hidden="true"
              accept={TEMPLATE_IMAGE_TYPES.join(',')}
              data-testid="template-image-input"
              onChange={(event) => void onImage(event)}
            />
          </div>
          {imageError ? (
            <Alert
              tone="error"
              onDismiss={() => setImageError(null)}
              dismissLabel={t('common.dismiss')}
            >
              {imageError}
            </Alert>
          ) : null}
          <CodeEditor
            label={t('certificateTemplate.editor.label')}
            hint={t('certificateTemplate.editor.hint')}
            value={html}
            onChange={setHtml}
            textareaRef={textarea}
            error={
              problems && problems.length > 0 ? t('certificateTemplate.editor.invalid') : undefined
            }
            counter={t('certificateTemplate.editor.size', {
              size: formatKib(bytes, i18n.language),
              max: formatKib(TEMPLATE_MAX_BYTES, i18n.language),
            })}
            counterInvalid={tooLarge}
          />
          {tooLarge ? (
            <Alert tone="warning">
              {t('certificateTemplate.editor.tooLarge', {
                max: formatKib(TEMPLATE_MAX_BYTES, i18n.language),
              })}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <AdminButton
              variant="primary"
              disabled={save.busy || !dirty || empty}
              onClick={() => void onSave()}
            >
              {save.busy ? t('common.saving') : t('certificateTemplate.save')}
            </AdminButton>
            <AdminButton
              icon={<FileText size={16} aria-hidden="true" />}
              disabled={previewBusy || empty}
              onClick={() => void onPreview()}
            >
              {previewBusy
                ? t('certificateTemplate.preview.busy')
                : t('certificateTemplate.preview.open')}
            </AdminButton>
            {baseline.html !== null ? (
              <AdminButton variant="ghost" onClick={() => setConfirm('delete')}>
                {t('certificateTemplate.delete.open')}
              </AdminButton>
            ) : null}
          </div>
          <PreviewState
            id={previewId}
            status={previewStatus}
            reason={preview.data?.error ?? null}
            requestError={previewError}
            queryError={previewId && preview.isError ? message(preview.error) : null}
          />
        </div>

        <AdminCard pad className="flex min-w-0 flex-col gap-3 self-start">
          <h3 className="m-0 text-base text-ink">{t('certificateTemplate.keys.title')}</h3>
          <p className="m-0 text-sm text-ink-3">{t('certificateTemplate.keys.text')}</p>
          {reference.isPending ? (
            <LoadingState inline label={t('certificateTemplate.keys.loading')} />
          ) : reference.isError ? (
            <QueryErrorState
              error={reference.error}
              title={t('certificateTemplate.keys.errorTitle')}
              onRetry={() => void reference.refetch()}
              retrying={reference.isFetching}
            />
          ) : (
            <KeywordList keys={reference.data.keys} />
          )}
        </AdminCard>
      </div>

      <ConfirmDialog
        open={confirm === 'model'}
        onCancel={() => setConfirm(null)}
        onConfirm={applyModel}
        title={t('certificateTemplate.model.title')}
        itemName={t(`certificateTemplate.title.${scope.kind}`)}
        message={t('certificateTemplate.model.text')}
        confirmLabel={t('certificateTemplate.model.confirm')}
        cancelLabel={t('common.cancel')}
      />
      {confirm === 'delete' ? (
        <ConfirmAction
          destructive
          title={t('certificateTemplate.delete.title')}
          itemName={t(`certificateTemplate.title.${scope.kind}`)}
          message={t(`certificateTemplate.delete.text.${scope.kind}`)}
          confirmLabel={t('certificateTemplate.delete.confirm')}
          busyLabel={t('certificateTemplate.delete.busy')}
          describeError={message}
          action={async (): Promise<CertificateTemplate> => {
            const { data } =
              scope.kind === 'course'
                ? await api.DELETE('/api/v1/courses/{id}/certificate-template', {
                    params: { path: { id: scope.courseId } },
                  })
                : await api.DELETE('/api/v1/settings/certificate-template');
            if (!data) throw new Error('DELETE do template do certificado respondeu sem corpo');
            return data;
          }}
          onClose={() => setConfirm(null)}
          onDone={(fresh) => {
            setBaseline(fresh);
            setHtml(fresh.html ?? '');
            setProblems(null);
            setBackfill(false);
            void templatesChanged(queryClient);
            toast.success(t('certificateTemplate.delete.done'));
          }}
        />
      ) : null}
    </div>
  );
}

/** Problemas da validação, cada um com a linha e um botão que leva o cursor a ela. */
function ProblemList({
  problems,
  onSelect,
}: {
  problems: CertificateTemplateProblem[];
  onSelect: (problem: CertificateTemplateProblem) => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert tone="error" title={t('certificateTemplate.problems.title', { count: problems.length })}>
      <ol className="m-0 flex flex-col gap-1 ps-5">
        {problems.map((problem, index) => (
          // a lista não muda depois de mostrada: a posição identifica o item
          // biome-ignore lint/suspicious/noArrayIndexKey: itens sem identificador próprio
          <li key={index}>
            <button type="button" className="nuva-linkbutton" onClick={() => onSelect(problem)}>
              {t('certificateTemplate.problems.at', {
                line: problem.line,
                column: problem.column,
              })}
            </button>
            {': '}
            {t(`certificateTemplate.problems.rules.${problem.rule}`)}
            {' — '}
            {problem.message}
          </li>
        ))}
      </ol>
      {problems.length >= TEMPLATE_PROBLEMS_MAX ? (
        <p className="mt-2 mb-0">
          {t('certificateTemplate.problems.more', { count: problems.length })}
        </p>
      ) : null}
      {problems.length === 0 ? (
        <p className="m-0">{t('certificateTemplate.problems.none')}</p>
      ) : null}
    </Alert>
  );
}

interface PreviewStateProps {
  id: string | null;
  status: 'pending' | 'ready' | 'failed' | undefined;
  reason: string | null;
  requestError: string | null;
  queryError: string | null;
}

/** Andamento do PDF de exemplo: gerando, pronto (com o link) ou falhou (com o motivo). */
function PreviewState({ id, status, reason, requestError, queryError }: PreviewStateProps) {
  const { t } = useTranslation();
  if (requestError) {
    return (
      <Alert tone="error" title={t('certificateTemplate.preview.errorTitle')}>
        {requestError}
      </Alert>
    );
  }
  if (!id) return null;
  if (queryError) {
    return (
      <Alert tone="error" title={t('certificateTemplate.preview.errorTitle')}>
        {queryError}
      </Alert>
    );
  }
  if (status === 'ready') {
    return (
      <Alert tone="success" title={t('certificateTemplate.preview.ready')}>
        <TextLink href={previewPdfPath(id)} external newTabLabel={t('common.newTab')}>
          {t('certificateTemplate.preview.link')}
        </TextLink>
      </Alert>
    );
  }
  if (status === 'failed') {
    return (
      <Alert tone="error" title={t('certificateTemplate.preview.failed')}>
        {reason ?? t('certificateTemplate.preview.failedText')}
      </Alert>
    );
  }
  return <LoadingState inline label={t('certificateTemplate.preview.pending')} />;
}
