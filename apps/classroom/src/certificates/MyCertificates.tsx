import {
  AdminCard,
  AdminEmpty,
  AdminSection,
  AdminStatus,
  Alert,
  ErrorState,
  LoadingState,
  TextLink,
} from '@nuva-edu/ui';
import { Award } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { describeError } from '../api/errors';
import { useDateFormatter } from '../catalog/format';
import { coursePath } from '../learning/progress';
import { CertificateDownload } from './CertificateDownload';
import { CertificateName } from './CertificateName';
import {
  type AwaitingCertificate,
  MY_CERTIFICATES_ID,
  type MyCertificate,
  useMyCertificates,
  validationPath,
} from './certificates';

const STATUS_TONES = { preparing: 'amber', issued: 'green', revoked: 'red' } as const;

/** Um certificado: os dados congelados, o estado e, quando emitido, o download e a validação. */
function CertificateItem({ item }: { item: MyCertificate }) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  return (
    <AdminCard pad as="article" aria-label={item.courseTitle}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="m-0 min-w-0 break-words text-base font-semibold text-ink">
            <TextLink href={coursePath(item.course.slug)} quiet>
              {item.courseTitle}
            </TextLink>
          </h3>
          <AdminStatus tone={STATUS_TONES[item.state]}>
            {t(`certificates.badge.${item.state}`)}
          </AdminStatus>
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-ink-2">
          <li>{t('certificates.hours', { count: item.hours })}</li>
          <li>{t('certificates.section.completedOn', { date: formatDate(item.completedAt) })}</li>
          <li>{t('certificates.section.issuedOn', { date: formatDate(item.issuedAt) })}</li>
          <li className="break-all">{t('certificates.section.code', { code: item.code })}</li>
        </ul>
        {item.state === 'revoked' ? (
          <p className="m-0 text-sm text-ink-2">
            {item.revokedAt
              ? t('certificates.section.revokedOn', { date: formatDate(item.revokedAt) })
              : t('certificates.state.revoked')}
          </p>
        ) : null}
        {item.state === 'preparing' ? (
          <p className="m-0 text-sm text-ink-2">{t('certificates.state.preparing')}</p>
        ) : null}
        {item.state === 'issued' ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CertificateDownload
              certificateId={item.id}
              code={item.code}
              title={item.courseTitle}
              variant="primary"
            />
            <TextLink
              href={validationPath(item.code)}
              aria-label={t('certificates.section.validateOf', { title: item.courseTitle })}
            >
              {t('certificates.section.validate')}
            </TextLink>
          </div>
        ) : null}
      </div>
    </AdminCard>
  );
}

/** Curso concluído sem template efetivo: o aviso, sem botão de download (spec 015, RF-12). */
function AwaitingItem({ item }: { item: AwaitingCertificate }) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  return (
    <li>
      <AdminCard pad as="article" aria-label={item.course.title}>
        <div className="flex flex-col gap-2">
          <h4 className="m-0 break-words text-base font-semibold text-ink">
            <TextLink href={coursePath(item.course.slug)} quiet>
              {item.course.title}
            </TextLink>
          </h4>
          <p className="m-0 text-sm text-ink-2">
            {t('certificates.section.completedOn', { date: formatDate(item.completedAt) })}
          </p>
        </div>
      </AdminCard>
    </li>
  );
}

/**
 * Seção "Certificados" de `/progresso` (spec 006; spec 015): o nome que sairá nos próximos, com
 * "Alterar", os certificados emitidos e os cursos que aguardam o template. Abre direto pelo
 * endereço `/progresso#certificados`, que a estante usa.
 */
export function MyCertificates() {
  const { t } = useTranslation();
  const query = useMyCertificates();
  const { hash } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const loaded = query.isSuccess;

  useEffect(() => {
    if (hash !== `#${MY_CERTIFICATES_ID}` || !loaded) return;
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, [hash, loaded]);

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('certificates.section.loading')} />
      </AdminCard>
    );
  } else if (query.isError) {
    const failure = describeError(t, query.error);
    body = (
      <AdminCard pad>
        <ErrorState
          title={t('certificates.section.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  } else {
    const { studentName, items, awaitingTemplate } = query.data;
    body = (
      <div className="flex flex-col gap-4">
        <AdminCard pad>
          <CertificateName name={studentName} label={t('certificates.name.next')} />
        </AdminCard>
        {items.length === 0 && awaitingTemplate.length === 0 ? (
          <AdminCard>
            <AdminEmpty
              icon={<Award aria-hidden="true" />}
              title={t('certificates.section.emptyTitle')}
              text={t('certificates.section.emptyText')}
            />
          </AdminCard>
        ) : null}
        {items.length > 0 ? (
          <ul
            aria-label={t('certificates.section.list')}
            className="m-0 grid list-none gap-4 p-0 md:grid-cols-2"
          >
            {items.map((item) => (
              <li key={item.id}>
                <CertificateItem item={item} />
              </li>
            ))}
          </ul>
        ) : null}
        {awaitingTemplate.length > 0 ? (
          <section className="flex flex-col gap-3" aria-labelledby="certificates-awaiting">
            <h3 id="certificates-awaiting" className="m-0 text-sm font-semibold text-ink">
              {t('certificates.section.awaitingTitle')}
            </h3>
            <Alert tone="info">{t('certificates.state.awaiting_template')}</Alert>
            <ul
              aria-label={t('certificates.section.awaitingList')}
              className="m-0 grid list-none gap-4 p-0 md:grid-cols-2"
            >
              {awaitingTemplate.map((item) => (
                <AwaitingItem key={item.course.id} item={item} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div id={MY_CERTIFICATES_ID} ref={ref} className="scroll-mt-20">
      <AdminSection title={t('certificates.section.title')}>
        <p className="m-0 mb-3 text-sm text-ink-2">{t('certificates.section.lead')}</p>
        {body}
      </AdminSection>
    </div>
  );
}
