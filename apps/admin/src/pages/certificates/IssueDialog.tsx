import { AdminButton, AdminSearch, AdminTextArea, Alert, Dialog, TextLink } from '@nuva-edu/ui';
import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProductSearch } from '../../api/access';
import { useAction } from '../../api/action';
import {
  CERTIFICATE_REASON_MAX,
  type Certificate,
  courseTemplatePath,
  useUserSearch,
} from '../../api/certificates';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { isTemplateMissing, refusedFields, useCertificateError } from './errors';

interface Props {
  onClose: () => void;
  onDone: (certificate: Certificate) => void;
}

interface Choice {
  id: string;
  label: string;
  detail?: string | undefined;
}

interface Problems {
  student?: string;
  course?: string;
  reason?: string;
}

/**
 * Emissão manual (`POST /api/v1/certificates`; spec 015, `certificate.issue`): aluno, curso e
 * motivo obrigatório. Curso sem template efetivo (`422` `certificate_template_missing`) mostra o
 * caminho para o template do curso.
 */
export function IssueDialog({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const formId = useId();
  const message = useCertificateError();
  const [student, setStudent] = useState<Choice | null>(null);
  const [course, setCourse] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<Problems>({});

  const issue = useAction(async (userId: string, courseId: string) => {
    const { data } = await api.POST('/api/v1/certificates', {
      body: { userId, courseId, reason: reason.trim() },
    });
    if (!data) throw new Error('POST /api/v1/certificates respondeu sem corpo');
    return data;
  });
  const refused = refusedFields(issue.error);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    if (!student) found.student = t('certificates.issue.studentRequired');
    if (!course) found.course = t('certificates.issue.courseRequired');
    if (reason.trim() === '') found.reason = t('forms.required');
    setProblems(found);
    issue.reset();
    if (!student || !course || found.reason) return;
    const result = await issue.run(student.id, course.id);
    if (result.ok) onDone(result.data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('certificates.issue.title')}
      description={t('certificates.issue.description')}
      closeLabel={t('common.close')}
      dismissible={!issue.busy}
      footer={
        <>
          <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={issue.busy}>
            {issue.busy ? t('certificates.issue.busy') : t('certificates.issue.submit')}
          </AdminButton>
        </>
      }
    >
      {issue.error && isTemplateMissing(issue.error) && course ? (
        <Alert tone="error" className="mb-4" title={t('certificates.templateMissing.title')}>
          {t('certificates.templateMissing.text', { title: course.label })}{' '}
          <TextLink href={courseTemplatePath(course.id)}>
            {t('certificates.templateMissing.link')}
          </TextLink>
        </Alert>
      ) : issue.error ? (
        <Alert tone="error" className="mb-4">
          {message(issue.error)}
        </Alert>
      ) : null}
      <form
        id={formId}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
      >
        <Chosen
          label={t('certificates.issue.student')}
          choice={student}
          changeLabel={t('certificates.issue.studentChange')}
          onClear={() => setStudent(null)}
          error={problems.student ?? (refused.has('userId') ? t('forms.invalid') : undefined)}
        >
          <StudentPicker onPick={setStudent} />
        </Chosen>
        <Chosen
          label={t('certificates.issue.course')}
          choice={course}
          changeLabel={t('certificates.issue.courseChange')}
          onClear={() => {
            setCourse(null);
            issue.reset();
          }}
          error={problems.course ?? (refused.has('courseId') ? t('forms.invalid') : undefined)}
        >
          <CoursePicker onPick={setCourse} />
        </Chosen>
        <AdminTextArea
          label={t('certificates.issue.reason')}
          hint={t('certificates.issue.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={CERTIFICATE_REASON_MAX}
          rows={3}
          error={problems.reason ?? (refused.has('reason') ? t('forms.invalid') : undefined)}
        />
      </form>
    </Dialog>
  );
}

/** Um campo de escolha: o escolhido com "trocar", ou a busca. */
function Chosen({
  label,
  choice,
  changeLabel,
  onClear,
  error,
  children,
}: {
  label: string;
  choice: Choice | null;
  changeLabel: string;
  onClear: () => void;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      {choice ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>{choice.label}</span>
          {choice.detail ? <span className="text-sm text-ink-3">{choice.detail}</span> : null}
          <AdminButton size="sm" onClick={onClear}>
            {changeLabel}
          </AdminButton>
        </div>
      ) : (
        children
      )}
      {error ? (
        <span role="alert" className="text-sm text-ink">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function StudentPicker({ onPick }: { onPick: (choice: Choice) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState<string | undefined>(undefined);
  const list = useUserSearch(q);
  return (
    <Picker
      searchLabel={t('certificates.issue.studentSearch')}
      placeholder={t('certificates.issue.studentPlaceholder')}
      resultsLabel={t('certificates.issue.studentResults')}
      errorTitle={t('certificates.issue.studentSearchError')}
      emptyText={t('certificates.issue.studentNoResults')}
      onSearch={setQ}
      onPick={onPick}
      pending={list.isPending}
      error={list.isError ? list.error : null}
      retrying={list.isFetching}
      onRetry={() => void list.refetch()}
      choices={(list.data ?? []).map((user) => ({
        id: user.id,
        label: user.name,
        detail: user.email,
      }))}
    />
  );
}

function CoursePicker({ onPick }: { onPick: (choice: Choice) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState<string | undefined>(undefined);
  const list = useProductSearch('course', q);
  return (
    <Picker
      searchLabel={t('certificates.issue.courseSearch')}
      placeholder={t('courses.filters.searchPlaceholder')}
      resultsLabel={t('access.grant.resultsLabel')}
      errorTitle={t('access.grant.searchError')}
      emptyText={t('access.grant.noResults')}
      onSearch={setQ}
      onPick={onPick}
      pending={list.isPending}
      error={list.isError ? list.error : null}
      retrying={list.isFetching}
      onRetry={() => void list.refetch()}
      choices={(list.data ?? []).map((item) => ({ id: item.id, label: item.title }))}
    />
  );
}

interface PickerProps {
  searchLabel: string;
  placeholder: string;
  resultsLabel: string;
  errorTitle: string;
  emptyText: string;
  onSearch: (q: string | undefined) => void;
  onPick: (choice: Choice) => void;
  pending: boolean;
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
  choices: Choice[];
}

/** Busca e escolha: os primeiros resultados; quem não acha refina a busca. */
function Picker(props: PickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const apply = () => props.onSearch(search.trim() || undefined);
  // o campo está dentro do formulário da emissão: Enter busca, não envia
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    apply();
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSearch
          value={search}
          onChange={setSearch}
          onKeyDown={onKeyDown}
          label={props.searchLabel}
          placeholder={props.placeholder}
          maxLength={200}
        />
        <AdminButton aria-label={props.searchLabel} onClick={apply}>
          {t('certificates.issue.search')}
        </AdminButton>
      </div>
      {props.pending ? (
        <p role="status" className="m-0 text-sm text-ink-3">
          {t('certificates.issue.loading')}
        </p>
      ) : props.error ? (
        <QueryErrorState
          error={props.error}
          title={props.errorTitle}
          onRetry={props.onRetry}
          retrying={props.retrying}
        />
      ) : props.choices.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{props.emptyText}</p>
      ) : (
        <ul aria-label={props.resultsLabel} className="m-0 flex list-none flex-col gap-2 p-0">
          {props.choices.map((choice) => (
            <li
              key={choice.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2"
            >
              <span>{choice.label}</span>
              {choice.detail ? <span className="text-sm text-ink-3">{choice.detail}</span> : null}
              <span className="ml-auto">
                <AdminButton
                  size="sm"
                  aria-label={t('certificates.issue.chooseOf', { name: choice.label })}
                  onClick={() => props.onPick(choice)}
                >
                  {t('certificates.issue.choose')}
                </AdminButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
