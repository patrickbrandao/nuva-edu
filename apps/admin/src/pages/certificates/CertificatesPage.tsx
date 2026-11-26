import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminEmpty,
  AdminMenu,
  AdminPageHeader,
  AdminSearch,
  AdminStatus,
  AdminTable,
  AdminTag,
  Alert,
  ConfirmDialog,
  LoadingState,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Download, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import {
  CERTIFICATE_CODE_MAX,
  CERTIFICATE_STATES,
  type Certificate,
  type CertificateState,
  certificateFileName,
  certificatesChanged,
  courseTemplatePath,
  hasPdf,
  isPreparing,
  useCertificatesList,
} from '../../api/certificates';
import { useApi } from '../../api/client';
import { coursePath } from '../../api/courses';
import { saveBlob } from '../../api/download';
import { QueryErrorState } from '../../api/problems';
import { formatDate, formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { userPath } from '../users/UserBits';
import { isTemplateMissing, useCertificateError } from './errors';
import { IssueDialog } from './IssueDialog';
import { RevokeCertificateDialog } from './RevokeCertificateDialog';

const ALL = 'all';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const STATE_TONES: Record<CertificateState, string> = {
  preparing: 'amber',
  issued: 'green',
  revoked: 'red',
};

type Pending =
  | { kind: 'revoke'; certificate: Certificate }
  | { kind: 'restore'; certificate: Certificate }
  | { kind: 'reissue'; certificate: Certificate };

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/**
 * Certificados (spec 006, mapa de telas; spec 015; `GET /api/v1/certificates`, `progress.view`):
 * lista com filtros no endereço, "Baixar PDF", emissão manual e reemissão (`certificate.issue`),
 * revogar e desfazer (`certificate.revoke`). Os botões seguem as ações da sessão; quem autoriza
 * é a API.
 */
export function CertificatesPage() {
  const { t } = useTranslation();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useCertificateError();
  const [params, setParams] = useSearchParams();
  const code = params.get('code')?.trim() || undefined;
  const state = pick(params.get('state'), CERTIFICATE_STATES);
  const courseId = UUID.test(params.get('courseId') ?? '')
    ? (params.get('courseId') as string)
    : '';
  const userId = UUID.test(params.get('userId') ?? '') ? (params.get('userId') as string) : '';
  const [search, setSearch] = useState(code ?? '');
  useEffect(() => setSearch(code ?? ''), [code]);
  const [issuing, setIssuing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  /** Curso recusado na reemissão por falta de template efetivo. */
  const [templateless, setTemplateless] = useState<Certificate['course'] | null>(null);

  const list = useCertificatesList({
    ...(code ? { code } : {}),
    ...(state ? { state } : {}),
    ...(courseId ? { courseId } : {}),
    ...(userId ? { userId } : {}),
  });
  const rows: Certificate[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(code || state || courseId || userId);
  const refresh = () => void certificatesChanged(queryClient);

  const update = (key: string, value: string | undefined) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== ALL) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    update('code', search.trim() || undefined);
  };

  const download = async (certificate: Certificate) => {
    setDownloading(certificate.id);
    try {
      const { data } = await api.GET('/api/v1/certificates/{id}/pdf', {
        params: { path: { id: certificate.id } },
        parseAs: 'blob',
        headers: { Accept: 'application/pdf, application/problem+json' },
      });
      if (!data) throw new Error('GET /api/v1/certificates/{id}/pdf respondeu sem corpo');
      saveBlob(data, certificateFileName(certificate.code));
    } catch (error) {
      // PDF ainda não gerado ou já apagado: aviso, e a lista mostra o estado atual
      const { code: label } = certificate;
      if (isApiError(error) && error.code === 'certificate_preparing') {
        toast.warning(t('certificates.download.preparing', { code: label }));
        refresh();
      } else if (isApiError(error) && error.status === 404) {
        toast.warning(t('certificates.download.notFound', { code: label }));
        refresh();
      } else {
        toast.error(message(error), { title: t('certificates.download.failed', { code: label }) });
      }
    } finally {
      setDownloading(null);
    }
  };

  const confirmed = useAction(async (action: Pending): Promise<Certificate> => {
    const path =
      action.kind === 'restore'
        ? ('/api/v1/certificates/{id}/restore' as const)
        : ('/api/v1/certificates/{id}/reissue' as const);
    const { data } = await api.POST(path, { params: { path: { id: action.certificate.id } } });
    if (!data) throw new Error(`POST ${path} respondeu sem corpo`);
    return data;
  });

  const onConfirm = async (action: Pending) => {
    const result = await confirmed.run(action);
    setPending(null);
    refresh();
    if (result.ok) {
      setTemplateless(null);
      toast.success(t(`certificates.${action.kind}.done`, { code: result.data.code }));
    } else if (isTemplateMissing(result.error)) {
      setTemplateless(action.certificate.course);
    } else {
      toast.error(message(result.error), { title: t(`certificates.${action.kind}.title`) });
    }
  };

  const stateOptions = [
    { id: ALL, label: t('certificates.filters.allStates') },
    ...CERTIFICATE_STATES.map((id) => ({ id, label: t(`certificates.states.${id}`) })),
  ];
  const stateLabel = stateOptions.find((option) => option.id === (state ?? ALL))?.label ?? '';
  const filteredCourse = courseId ? rows.find((row) => row.course.id === courseId)?.course : null;
  const filteredUser = userId ? rows.find((row) => row.user.id === userId)?.user : null;

  // a ficha do aluno é de quem vê os dados dele, e o editor do curso, de quem o edita
  const linkStudent = can('users.view_private');
  const linkCourse = can('course.edit');
  const canIssue = can('certificate.issue');
  const canRevoke = can('certificate.revoke');

  const columns = [
    {
      id: 'student',
      label: t('certificates.columns.student'),
      render: ({ user, studentName }: Certificate) =>
        studentName === null ? (
          <span className="text-ink-3">{t('certificates.accountRemoved')}</span>
        ) : linkStudent ? (
          <TextLink href={userPath(user.id)} quiet>
            {studentName}
          </TextLink>
        ) : (
          studentName
        ),
    },
    {
      id: 'course',
      label: t('certificates.columns.course'),
      render: ({ course, courseTitle, hours }: Certificate) => (
        <span className="inline-flex flex-col">
          {linkCourse ? (
            <TextLink href={coursePath(course.id)} quiet>
              {courseTitle}
            </TextLink>
          ) : (
            courseTitle
          )}
          <span className="text-xs text-ink-3">{t('certificates.hours', { count: hours })}</span>
        </span>
      ),
    },
    {
      id: 'code',
      label: t('certificates.columns.code'),
      render: (certificate: Certificate) => <code>{certificate.code}</code>,
    },
    {
      id: 'state',
      label: t('certificates.columns.state'),
      render: (certificate: Certificate) => (
        <span className="inline-flex flex-col items-start gap-1">
          <AdminStatus tone={STATE_TONES[certificate.state]}>
            {t(`certificates.states.${certificate.state}`)}
          </AdminStatus>
          {certificate.revokedAt ? (
            <span className="text-xs text-ink-3">
              {t('certificates.revokedOn', { date: formatDate(certificate.revokedAt) })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'issuedAt',
      label: t('certificates.columns.issuedAt'),
      render: (certificate: Certificate) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {formatDateTime(certificate.issuedAt)}
          {certificate.issuedManually ? <AdminTag>{t('certificates.manual')}</AdminTag> : null}
        </span>
      ),
    },
    {
      id: 'actions',
      label: t('certificates.columns.actions'),
      render: (certificate: Certificate) => {
        const { code: label } = certificate;
        const revoked = certificate.revokedAt !== null;
        return (
          <span className="inline-flex flex-wrap items-center gap-2">
            {isPreparing(certificate) ? (
              <span className="text-sm text-ink-3">{t('certificates.preparing')}</span>
            ) : hasPdf(certificate) ? (
              <AdminButton
                size="sm"
                icon={<Download size={14} aria-hidden="true" />}
                aria-label={t('certificates.download.openOf', { code: label })}
                disabled={downloading === certificate.id}
                aria-busy={downloading === certificate.id || undefined}
                onClick={() => void download(certificate)}
              >
                {downloading === certificate.id
                  ? t('certificates.download.busy')
                  : t('certificates.download.open')}
              </AdminButton>
            ) : (
              <span className="text-sm text-ink-3">{t('certificates.noPdf')}</span>
            )}
            {canIssue && !revoked && certificate.studentName !== null ? (
              <AdminButton
                size="sm"
                aria-label={t('certificates.reissue.openOf', { code: label })}
                onClick={() => setPending({ kind: 'reissue', certificate })}
              >
                {t('certificates.reissue.open')}
              </AdminButton>
            ) : null}
            {canRevoke ? (
              revoked ? (
                <AdminButton
                  size="sm"
                  aria-label={t('certificates.restore.openOf', { code: label })}
                  onClick={() => setPending({ kind: 'restore', certificate })}
                >
                  {t('certificates.restore.open')}
                </AdminButton>
              ) : (
                <AdminButton
                  size="sm"
                  aria-label={t('certificates.revoke.openOf', { code: label })}
                  onClick={() => setPending({ kind: 'revoke', certificate })}
                >
                  {t('certificates.revoke.open')}
                </AdminButton>
              )
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.certificates')}
        subtitle={t('certificates.subtitle')}
        actions={
          canIssue ? (
            <AdminButton variant="primary" onClick={() => setIssuing(true)}>
              {t('certificates.issue.open')}
            </AdminButton>
          ) : null
        }
      />

      {templateless ? (
        <Alert tone="error" className="mb-4" title={t('certificates.templateMissing.title')}>
          {t('certificates.templateMissing.text', { title: templateless.title })}{' '}
          <TextLink href={courseTemplatePath(templateless.id)}>
            {t('certificates.templateMissing.link')}
          </TextLink>
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('certificates.filters.search')}
            placeholder={t('certificates.filters.searchPlaceholder')}
            maxLength={CERTIFICATE_CODE_MAX}
          />
          <AdminButton type="submit">{t('certificates.filters.searchButton')}</AdminButton>
        </form>
        <AdminMenu
          options={stateOptions}
          value={state ?? ALL}
          onChange={(id: string) => update('state', id)}
          aria-label={t('certificates.filters.stateLabel', { value: stateLabel })}
        />
        {courseId ? (
          <AdminButton
            size="sm"
            iconEnd={<X size={14} aria-hidden="true" />}
            aria-label={t('certificates.filters.removeCourse')}
            onClick={() => update('courseId', undefined)}
          >
            {filteredCourse
              ? t('certificates.filters.course', { title: filteredCourse.title })
              : t('certificates.filters.oneCourse')}
          </AdminButton>
        ) : null}
        {userId ? (
          <AdminButton
            size="sm"
            iconEnd={<X size={14} aria-hidden="true" />}
            aria-label={t('certificates.filters.removeStudent')}
            onClick={() => update('userId', undefined)}
          >
            {filteredUser
              ? t('certificates.filters.student', { name: filteredUser.name })
              : t('certificates.filters.oneStudent')}
          </AdminButton>
        ) : null}
      </div>

      {list.isPending ? (
        <LoadingState label={t('certificates.loading')} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('certificates.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            empty={
              <AdminEmpty
                icon={<Award aria-hidden="true" />}
                title={filtered ? t('certificates.emptyFiltered') : t('certificates.empty')}
                text={filtered ? t('certificates.emptyFilteredText') : t('certificates.emptyText')}
              >
                {filtered ? (
                  <AdminButton onClick={clear}>{t('certificates.filters.clear')}</AdminButton>
                ) : null}
              </AdminEmpty>
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
          {list.isFetchNextPageError ? (
            <Alert tone="error" className="mt-2">
              {t('certificates.loadMoreError')}
            </Alert>
          ) : null}
        </>
      )}

      {issuing ? (
        <IssueDialog
          onClose={() => setIssuing(false)}
          onDone={(certificate) => {
            setIssuing(false);
            refresh();
            toast.success(
              t('certificates.issue.done', {
                code: certificate.code,
                name: certificate.studentName ?? certificate.user.name,
              }),
            );
          }}
        />
      ) : null}
      {pending?.kind === 'revoke' ? (
        <RevokeCertificateDialog
          certificate={pending.certificate}
          onClose={() => setPending(null)}
          onStale={refresh}
          onDone={(revoked) => {
            setPending(null);
            refresh();
            toast.success(t('certificates.revoke.done', { code: revoked.code }));
          }}
        />
      ) : null}
      {pending?.kind === 'restore' || pending?.kind === 'reissue' ? (
        <ConfirmDialog
          open
          onCancel={() => setPending(null)}
          onConfirm={() => void onConfirm(pending)}
          title={t(`certificates.${pending.kind}.title`)}
          itemName={pending.certificate.code}
          message={t(`certificates.${pending.kind}.text`)}
          confirmLabel={
            pending.kind === 'restore'
              ? t('certificates.restore.submit')
              : t('certificates.reissue.open')
          }
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          busy={confirmed.busy}
          busyLabel={t(`certificates.${pending.kind}.busy`)}
          destructive={false}
        />
      ) : null}
    </>
  );
}
