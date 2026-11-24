import { isApiError } from '@nuva-edu/api-client/classroom';
import { AdminButton } from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError, formatWait } from '../api/errors';

/**
 * Botão "reenviar o link de confirmação" (`POST /api/v1/auth/email/resend`) e o resultado,
 * anunciado numa região viva. Até 3 por hora (`429` `rate_limited`, spec 007).
 */
export function ResendVerification({ email, size }: { email: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const api = useApi();
  const resend = useMutation({
    mutationFn: async () => {
      await api.POST('/api/v1/auth/email/resend');
    },
  });

  let result = '';
  if (resend.isSuccess) result = t('verifyEmail.resent', { email });
  else if (resend.isError) {
    const error = resend.error;
    result =
      isApiError(error) && error.code === 'rate_limited'
        ? error.retryAfter !== undefined
          ? t('verifyEmail.rateLimitedFor', { time: formatWait(t, error.retryAfter) })
          : t('verifyEmail.rateLimited')
        : [describeError(t, error).message, describeError(t, error).detail]
            .filter(Boolean)
            .join(' ');
  }

  return (
    <span className="flex flex-col items-start gap-1.5">
      <AdminButton size={size} onClick={() => resend.mutate()} disabled={resend.isPending}>
        {resend.isPending ? t('verifyEmail.resending') : t('verifyEmail.resend')}
      </AdminButton>
      <span role="status" className="text-[13px] text-ink-2">
        {result}
      </span>
    </span>
  );
}
