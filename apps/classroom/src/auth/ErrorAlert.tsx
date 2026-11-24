import { Alert } from '@nuva-edu/ui';
import type { ReactNode } from 'react';
import type { ErrorText } from '../api/errors';

/** Aviso de erro de uma ação, com o código da requisição para o suporte. */
export function ErrorAlert({
  error,
  title,
  actions,
}: {
  error: ErrorText | null;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  if (!error) return null;
  return (
    <Alert tone="error" title={title} actions={actions}>
      {error.message}
      {error.detail ? <span className="mt-1 block text-xs">{error.detail}</span> : null}
    </Alert>
  );
}
