import {
  AdminButton,
  AdminCard,
  AdminField,
  ErrorState,
  LoadingState,
  PageTitle,
} from '@nuva-edu/ui';
import { BadgeCheck, SearchX, ShieldOff, UserX } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { describeError } from '../api/errors';
import { useDateFormatter } from '../catalog/format';
import {
  type CertificateVerification,
  CODE_MAX_LENGTH,
  normalizeCode,
  useCertificateVerification,
  validationPath,
} from '../certificates/certificates';
import { usePageMeta } from '../lib/usePageMeta';

/** Formulário para digitar o código; leva a `/certificados/<código>`. */
function CodeForm({ initial }: { initial: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  // o "voltar" do navegador troca o código por fora do campo
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValue(initial);
    setError('');
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeCode(value);
    if (code === '') {
      setError(t('certificates.verify.required'));
      return;
    }
    setError('');
    navigate(validationPath(code));
  };

  return (
    <AdminCard pad as="section" aria-label={t('certificates.verify.form')}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={submit} noValidate>
        <AdminField
          className="min-w-0 flex-1 basis-56"
          label={t('certificates.verify.field')}
          hint={t('certificates.verify.hint')}
          error={error || undefined}
          placeholder={t('certificates.verify.placeholder')}
          value={value}
          maxLength={CODE_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={setValue}
        />
        <AdminButton type="submit" variant="primary">
          {t('certificates.verify.submit')}
        </AdminButton>
      </form>
    </AdminCard>
  );
}

/** Uma linha "rótulo: valor" da lista de dados do certificado. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="m-0 break-words text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

/** O cartão do resultado: ícone, título (que dá nome ao cartão), frase e os dados. */
function ResultCard({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <AdminCard pad as="article" aria-labelledby="certificate-result">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex shrink-0 text-ink-2">{icon}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="certificate-result" className="m-0 text-lg font-semibold text-ink">
              {title}
            </h2>
            <p className="m-0 text-sm text-ink-2">{text}</p>
          </div>
        </div>
        {children ? <dl className="m-0 grid gap-3 sm:grid-cols-2">{children}</dl> : null}
      </div>
    </AdminCard>
  );
}

/**
 * O resultado (spec 015, "Validação pública"): válido mostra aluno, curso, carga horária, datas e
 * escola; revogado só o estado e a data; titular removido o código, o curso e a data, sem o nome.
 * Nunca há e-mail, foto, link de perfil nem o PDF: o contrato não os traz.
 */
function Verification({ certificate }: { certificate: CertificateVerification }) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const code = <Fact label={t('certificates.verify.fields.code')}>{certificate.code}</Fact>;

  if (certificate.status === 'revoked') {
    return (
      <ResultCard
        icon={<ShieldOff size={22} aria-hidden="true" />}
        title={t('certificates.verify.revokedTitle')}
        text={
          certificate.revokedAt
            ? t('certificates.verify.revokedText', { date: formatDate(certificate.revokedAt) })
            : t('certificates.verify.revokedTextNoDate')
        }
      >
        {code}
      </ResultCard>
    );
  }

  const removed = certificate.status === 'holder_removed';
  return (
    <ResultCard
      icon={
        removed ? (
          <UserX size={22} aria-hidden="true" />
        ) : (
          <BadgeCheck size={22} aria-hidden="true" />
        )
      }
      title={removed ? t('certificates.verify.removedTitle') : t('certificates.verify.validTitle')}
      text={
        removed
          ? t('certificates.verify.removedText')
          : t('certificates.verify.validText', { school: certificate.schoolName ?? '' })
      }
    >
      {!removed && certificate.studentName ? (
        <Fact label={t('certificates.verify.fields.student')}>{certificate.studentName}</Fact>
      ) : null}
      {certificate.courseTitle ? (
        <Fact label={t('certificates.verify.fields.course')}>{certificate.courseTitle}</Fact>
      ) : null}
      {!removed && certificate.hours !== null ? (
        <Fact label={t('certificates.verify.fields.hours')}>
          {t('certificates.hours', { count: certificate.hours })}
        </Fact>
      ) : null}
      {certificate.completedAt ? (
        <Fact label={t('certificates.verify.fields.completedAt')}>
          {formatDate(certificate.completedAt)}
        </Fact>
      ) : null}
      {certificate.issuedAt ? (
        <Fact label={t('certificates.verify.fields.issuedAt')}>
          {formatDate(certificate.issuedAt)}
        </Fact>
      ) : null}
      {!removed && certificate.schoolName ? (
        <Fact label={t('certificates.verify.fields.school')}>{certificate.schoolName}</Fact>
      ) : null}
      {code}
    </ResultCard>
  );
}

function Result({ code }: { code: string }) {
  const { t } = useTranslation();
  const query = useCertificateVerification(code);

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('certificates.verify.loading')} />
      </AdminCard>
    );
  } else if (query.isError) {
    const failure = describeError(t, query.error);
    body = (
      <AdminCard pad>
        <ErrorState
          title={t('certificates.verify.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  } else if (query.data.kind === 'missing') {
    body = (
      <ResultCard
        icon={<SearchX size={22} aria-hidden="true" />}
        title={t('certificates.verify.missingTitle')}
        text={t('certificates.verify.missingText')}
      />
    );
  } else {
    body = <Verification certificate={query.data.certificate} />;
  }

  return (
    <section aria-label={t('certificates.verify.result')} aria-busy={query.isPending}>
      {body}
    </section>
  );
}

/**
 * `/certificados` e `/certificados/:codigo`: validação pública do certificado, sem login (spec
 * 015, "Validação pública"; mapa de telas da spec 006). O código vale com ou sem hífens.
 */
export function CertificateValidationPage() {
  const { t } = useTranslation();
  const { codigo = '' } = useParams();
  const code = normalizeCode(codigo);
  usePageMeta(t('pages.certificates'), t('certificates.verify.description'));
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageTitle subtitle={t('certificates.verify.lead')}>{t('pages.certificates')}</PageTitle>
      <CodeForm initial={code} />
      {code ? <Result code={code} /> : null}
    </div>
  );
}
