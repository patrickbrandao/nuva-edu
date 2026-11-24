import { isApiError } from '@nuva-edu/api-client/classroom';
import {
  AdminButton,
  AdminCard,
  AdminSection,
  Alert,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
} from '@nuva-edu/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError, type ErrorText, formatWait } from '../api/errors';
import { ErrorAlert } from '../auth/ErrorAlert';
import { useRefreshSession } from '../session/session';
import { ACCOUNT_SESSIONS_KEY, IDENTITIES_KEY } from './queries';

interface FieldErrors {
  current?: string;
  next?: string;
}

/**
 * Definir (conta sem senha) ou trocar a senha (`PUT /api/v1/account/password`, spec 007,
 * "Definir, trocar e redefinir senha"). Encerra as outras sessões: a lista é recarregada.
 */
export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const client = useQueryClient();
  const refreshSession = useRefreshSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [saved, setSaved] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async (body: { newPassword: string; currentPassword?: string }) => {
      await api.PUT('/api/v1/account/password', { body });
    },
    onMutate: () => {
      setFailure(null);
      setSaved(false);
    },
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setSaved(true);
      await Promise.all([
        refreshSession(),
        client.invalidateQueries({ queryKey: IDENTITIES_KEY }),
        client.invalidateQueries({ queryKey: ACCOUNT_SESSIONS_KEY }),
      ]);
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'current_password_invalid') {
        setErrors({ current: t('access.password.currentInvalid') });
        currentRef.current?.focus();
        return;
      }
      if (isApiError(error) && error.code === 'password_invalid') {
        setErrors({ next: t('password.invalid') });
        nextRef.current?.focus();
        return;
      }
      setFailure(
        describeError(t, error, {
          too_many_attempts:
            isApiError(error) && error.retryAfter !== undefined
              ? t('login.errors.tooManyAttempts', { time: formatWait(t, error.retryAfter) })
              : t('login.errors.tooManyAttemptsNoTime'),
        }),
      );
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: FieldErrors = {};
    if (hasPassword && !current) found.current = t('access.password.currentRequired');
    if (next.length < PASSWORD_MIN_LENGTH || next.length > PASSWORD_MAX_LENGTH) {
      found.next = t('password.invalid');
    }
    setErrors(found);
    if (found.current) return currentRef.current?.focus();
    if (found.next) return nextRef.current?.focus();
    save.mutate(
      hasPassword ? { newPassword: next, currentPassword: current } : { newPassword: next },
    );
  };

  return (
    <AdminSection title={t('access.password.title')}>
      <AdminCard pad>
        <form className="flex max-w-sm flex-col gap-4" onSubmit={onSubmit} noValidate>
          <p className="m-0 text-[13px] text-ink-3">
            {hasPassword ? t('access.password.changeLead') : t('access.password.setLead')}
          </p>
          {saved ? <Alert tone="success">{t('access.password.saved')}</Alert> : null}
          <ErrorAlert error={failure} />
          {hasPassword ? (
            <PasswordInput
              label={t('access.password.current')}
              name="currentPassword"
              autoComplete="current-password"
              value={current}
              onChange={setCurrent}
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              error={errors.current}
              inputRef={currentRef}
              minLength={0}
            />
          ) : null}
          <PasswordInput
            label={t('access.password.new')}
            name="newPassword"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            showLabel={t('password.show')}
            hideLabel={t('password.hide')}
            hint={t('signUp.passwordHint')}
            error={errors.next}
            inputRef={nextRef}
          />
          <span className="flex">
            <AdminButton type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending
                ? t('access.password.saving')
                : hasPassword
                  ? t('access.password.change')
                  : t('access.password.set')}
            </AdminButton>
          </span>
        </form>
      </AdminCard>
    </AdminSection>
  );
}
