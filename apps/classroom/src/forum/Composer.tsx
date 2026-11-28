import { AdminButton, PostComposer, type PostComposerProps } from '@nuva-edu/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMentions } from './queries';

interface ComposerProps {
  categoryId: string;
  title?: string | undefined;
  initialBody?: string | undefined;
  label: string;
  error?: string | undefined;
  busy: boolean;
  onSubmit: (bodyMd: string, title: string) => void;
  onCancel: () => void;
}

export function Composer({
  categoryId,
  title,
  initialBody = '',
  label,
  error,
  busy,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initialBody);
  const [invalid, setInvalid] = useState(false);
  const [heading, setHeading] = useState(title ?? '');
  const suggestionsId = useId();
  const fragment = /(?:^|\s)@([\p{L}\p{N}_-]{1,100})$/u.exec(body)?.[1] ?? '';
  const matches = useMentions(categoryId, fragment);
  const suggestions = fragment ? (matches.data?.items.filter(({ id }) => id !== null) ?? []) : [];
  const labels: PostComposerProps['labels'] = {
    label: t('forum.message'),
    region: label,
    submit: label,
    cancel: t('forum.cancel'),
    showPreview: t('forum.preview'),
    hidePreview: t('forum.write'),
    previewRegion: t('forum.preview'),
    emptyPreview: t('forum.emptyPreview'),
    counter: (used, max) => t('forum.counter', { used, max }),
  };
  return (
    <PostComposer
      title={
        title === undefined
          ? undefined
          : {
              value: heading,
              onChange: setHeading,
              label: t('forum.topicTitle'),
              minLength: 5,
              maxLength: 150,
            }
      }
      value={body}
      onChange={(value) => {
        setBody(value);
        setInvalid(false);
      }}
      labels={labels}
      onSubmit={() => {
        if (!body.trim() || (title !== undefined && [...heading.trim()].length < 5)) {
          setInvalid(true);
          return;
        }
        onSubmit(body.trim(), heading.trim());
      }}
      onCancel={onCancel}
      busy={busy}
      error={invalid ? t('forum.invalidMessage') : error}
      mention={
        suggestions.length > 0 ? (
          <ul
            id={suggestionsId}
            aria-label={t('forum.mentions')}
            className="m-0 flex flex-wrap gap-2 list-none p-0"
          >
            {suggestions.map(({ id, displayName }) => (
              <li key={id}>
                <AdminButton
                  onClick={() => {
                    const escaped = displayName.replace(/[\\[\]]/g, '\\$&');
                    setBody(
                      (value) => `${value.slice(0, -(fragment.length + 1))}[@${escaped}](#${id}) `,
                    );
                  }}
                >
                  @{displayName}
                </AdminButton>
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}
