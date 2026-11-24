import { type ClassroomSession, isApiError, uploadImage } from '@nuva-edu/api-client/classroom';
import { AdminCard, AdminSection, ImagePicker, initialsOf, PageTitle } from '@nuva-edu/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/client';
import { describeError, formatWait } from '../api/errors';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { useRefreshSession } from '../session/session';

/** `/conta/perfil`: foto de perfil (spec 007, "Avatar"; spec 029). */
export function ProfilePage() {
  const { t } = useTranslation();
  usePageMeta(t('profile.title'), t('profile.description'));
  return <RequireSession>{(session) => <Profile session={session} />}</RequireSession>;
}

function Profile({ session }: { session: ClassroomSession }) {
  const { t } = useTranslation();
  const api = useApi();
  const refreshSession = useRefreshSession();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Trocar a chave remonta o seletor: some a prévia da imagem que não foi aceita.
  const [pickerKey, setPickerKey] = useState(0);

  const errorText = (cause: unknown): string => {
    if (isApiError(cause) && cause.code === 'rate_limited') {
      return cause.retryAfter !== undefined
        ? t('profile.errors.rateLimitedFor', { time: formatWait(t, cause.retryAfter) })
        : t('profile.errors.rateLimited');
    }
    const text = describeError(t, cause, {
      payload_too_large: t('profile.errors.tooLarge'),
      image_type_unsupported: t('profile.errors.wrongType'),
      unsupported_media_type: t('profile.errors.wrongType'),
      image_dimensions_exceeded: t('profile.errors.dimensions'),
      image_too_heavy: t('profile.errors.tooHeavy'),
      image_purpose_mismatch: t('profile.errors.generic'),
      image_processing_busy: t('profile.errors.busy'),
    });
    return [text.message, text.detail].filter(Boolean).join(' ');
  };

  const change = useMutation({
    mutationFn: async (file: File | null) => {
      let imageId: string | null = null;
      if (file) {
        const { data: image } = await uploadImage(api, file, 'avatar');
        if (!image) throw new Error('POST /api/v1/images respondeu sem corpo');
        imageId = image.id;
      }
      await api.PUT('/api/v1/me/profile/avatar', { body: { imageId } });
      return file !== null;
    },
    onMutate: () => {
      setError('');
      setDone('');
    },
    onSuccess: async (added) => {
      setDone(added ? t('profile.saved') : t('profile.removed'));
      await refreshSession();
      setPickerKey((key) => key + 1);
    },
    onError: (cause) => {
      setError(errorText(cause));
      setPickerKey((key) => key + 1);
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageTitle subtitle={t('profile.lead')}>{t('profile.title')}</PageTitle>
      <AdminSection title={t('profile.avatar.title')}>
        <AdminCard pad>
          <div className="flex flex-col gap-3">
            <ImagePicker
              key={pickerKey}
              label={t('profile.avatar.label')}
              chooseLabel={t('profile.avatar.choose')}
              changeLabel={t('profile.avatar.change')}
              removeLabel={t('profile.avatar.remove')}
              limitHint={t('profile.avatar.hint')}
              errors={{
                tooLarge: t('profile.errors.tooLarge'),
                wrongType: t('profile.errors.wrongType'),
              }}
              previewAlt={t('profile.avatar.previewAlt')}
              currentUrl={session.user.avatarUrl}
              placeholder={initialsOf(session.user.name)}
              error={error || undefined}
              busy={change.isPending}
              onChange={(file) => {
                if (file) change.mutate(file);
              }}
              onRemove={() => change.mutate(null)}
            />
            <p role="status" className="m-0 min-h-5 text-[13px] text-ink-2">
              {change.isPending ? t('profile.saving') : done}
            </p>
          </div>
        </AdminCard>
      </AdminSection>
    </div>
  );
}
