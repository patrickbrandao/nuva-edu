import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminField,
  AdminMenu,
  AdminSwitch,
  AdminTextArea,
  Alert,
  Dialog,
  LoadingState,
  SortableList,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  DESCRIPTION_MAX,
  DURATION_MAX_SECONDS,
  LESSON_LINKS_MAX,
  type LessonDetail,
  type LessonLinkKind,
  LINK_KINDS,
  refreshCourse,
  TITLE_MAX,
  URL_MAX,
  useLesson,
} from '../../api/courses';
import { useSortableLabels } from './CourseBits';
import { useCourseError, useFieldRefusal } from './errors';
import { formatDuration, parseDuration } from './format';

/**
 * Regras de URL de conteúdo da spec 009, conferidas antes de enviar: `https` (`http` só em
 * `*.localhost`), sem credenciais, sem espaços, até 2.000 caracteres. A API confere de novo.
 */
export function isContentUrl(value: string): boolean {
  if (value.length > URL_MAX || /\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
  );
}

interface LinkRow {
  key: string;
  label: string;
  url: string;
  kind: LessonLinkKind;
}

interface Props {
  courseId: string;
  /** Módulo que recebe a aula nova; `null` ao editar. */
  moduleId: string | null;
  moduleTitle: string | null;
  /** Aula a editar; `null` cria uma. */
  lessonId: string | null;
  onClose: () => void;
}

/**
 * Aula (spec 009, RF-05 e RF-09): título, vídeo por link, duração, descrição em Markdown,
 * amostra grátis e links de apoio. Editar busca a aula (`GET /lessons/{id}`), que traz o vídeo e
 * os links; o curso só tem o resumo.
 */
export function LessonDialog({ courseId, moduleId, moduleTitle, lessonId, onClose }: Props) {
  const { t } = useTranslation();
  const lesson = useLesson(lessonId);
  const message = useCourseError();

  // o formulário nasce da resposta: com a aula no cache, espera a leitura nova terminar
  if (lessonId && (!lesson.data || lesson.isFetching)) {
    const notFound = isApiError(lesson.error) && lesson.error.status === 404;
    return (
      <Dialog
        open
        onClose={onClose}
        title={t('courses.lessons.editTitle')}
        closeLabel={t('common.close')}
        footer={<AdminButton onClick={onClose}>{t('common.close')}</AdminButton>}
      >
        {lesson.isError && !lesson.isFetching ? (
          <Alert tone="error">
            {notFound ? t('courses.lessons.notFound') : message(lesson.error)}
          </Alert>
        ) : (
          <LoadingState label={t('courses.lessons.loading')} />
        )}
      </Dialog>
    );
  }

  return (
    <LessonForm
      courseId={courseId}
      moduleId={moduleId}
      moduleTitle={moduleTitle}
      initial={lesson.data ?? null}
      onClose={onClose}
    />
  );
}

interface FormProps {
  courseId: string;
  moduleId: string | null;
  moduleTitle: string | null;
  initial: LessonDetail | null;
  onClose: () => void;
}

function linkRows(lesson: LessonDetail | null): LinkRow[] {
  return (lesson?.links ?? []).map((link) => ({
    key: link.id,
    label: link.label,
    url: link.url,
    kind: link.kind,
  }));
}

const sameLinks = (a: readonly LinkRow[], b: readonly LinkRow[]): boolean =>
  a.length === b.length &&
  a.every((row, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      row.label.trim() === other.label &&
      row.url.trim() === other.url &&
      row.kind === other.kind
    );
  });

function LessonForm({ courseId, moduleId, moduleTitle, initial, onClose }: FormProps) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useCourseError();
  const labels = useSortableLabels();
  // depois de criada, a aula passa a ser editada: se só os links falharem, salvar de novo não a duplica
  const [saved, setSaved] = useState<LessonDetail | null>(initial);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? '');
  const [duration, setDuration] = useState(formatDuration(initial?.durationSeconds));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isSample, setIsSample] = useState(initial?.isSample ?? false);
  const [links, setLinks] = useState<LinkRow[]>(() => linkRows(initial));
  const [invalid, setInvalid] = useState<Map<string, string>>(new Map());
  const nextKey = useRef(0);

  const saveLesson = useAction(async (durationSeconds: number | null): Promise<LessonDetail> => {
    const fields = {
      title: title.trim(),
      description: description.trim() === '' ? null : description,
      videoUrl: videoUrl.trim() === '' ? null : videoUrl.trim(),
      durationSeconds,
      isSample,
    };
    if (!saved) {
      const { data } = await api.POST('/api/v1/modules/{id}/lessons', {
        params: { path: { id: moduleId ?? '' } },
        body: fields,
      });
      if (!data) throw new Error('POST /api/v1/modules/{id}/lessons respondeu sem corpo');
      return data;
    }
    // só o que mudou: o corpo vazio é recusado pelo contrato (`minProperties: 1`)
    const body = Object.fromEntries(
      Object.entries(fields).filter(([key, value]) => saved[key as keyof typeof fields] !== value),
    ) as Partial<typeof fields>;
    if (Object.keys(body).length === 0) return saved;
    const { data } = await api.PATCH('/api/v1/lessons/{id}', {
      params: { path: { id: saved.id } },
      body,
    });
    if (!data) throw new Error('PATCH /api/v1/lessons/{id} respondeu sem corpo');
    return data;
  });

  const saveLinks = useAction(async (lesson: LessonDetail): Promise<LessonDetail> => {
    const { data } = await api.PUT('/api/v1/lessons/{id}/links', {
      params: { path: { id: lesson.id } },
      body: {
        links: links.map((link) => ({
          label: link.label.trim(),
          url: link.url.trim(),
          kind: link.kind,
        })),
      },
    });
    if (!data) throw new Error('PUT /api/v1/lessons/{id}/links respondeu sem corpo');
    return data;
  });

  const lessonRefusal = useFieldRefusal(saveLesson.error);
  const linkRefused = new Set(
    isApiError(saveLinks.error)
      ? saveLinks.error.fieldErrors.map((field) => field.path.replace(/^body\./, ''))
      : [],
  );
  const busy = saveLesson.busy || saveLinks.busy;

  const fieldError = (field: string): string | undefined =>
    invalid.get(field) ??
    (linkRefused.has(field) ? t('courses.errors.content_url_invalid') : lessonRefusal.of(field));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problems = new Map<string, string>();
    if (title.trim() === '') problems.set('title', t('forms.required'));
    if (videoUrl.trim() !== '' && !isContentUrl(videoUrl.trim())) {
      problems.set('videoUrl', t('courses.errors.content_url_invalid'));
    }
    const seconds = parseDuration(duration);
    if (seconds === undefined || (seconds !== null && seconds > DURATION_MAX_SECONDS)) {
      problems.set('durationSeconds', t('courses.lessons.durationInvalid'));
    }
    links.forEach((link, index) => {
      if (link.label.trim() === '') problems.set(`links.${index}.label`, t('forms.required'));
      if (link.url.trim() === '') problems.set(`links.${index}.url`, t('forms.required'));
      else if (!isContentUrl(link.url.trim())) {
        problems.set(`links.${index}.url`, t('courses.errors.content_url_invalid'));
      }
    });
    setInvalid(problems);
    saveLesson.reset();
    saveLinks.reset();
    if (problems.size > 0 || seconds === undefined) return;

    const lessonResult = await saveLesson.run(seconds);
    if (!lessonResult.ok) return;
    setSaved(lessonResult.data);
    let latest = lessonResult.data;
    if (!sameLinks(links, linkRows(latest))) {
      const linksResult = await saveLinks.run(latest);
      if (!linksResult.ok) {
        void refreshCourse(queryClient, courseId);
        return;
      }
      latest = linksResult.data;
      setSaved(latest);
    }
    await refreshCourse(queryClient, courseId);
    toast.success(
      t(initial ? 'courses.lessons.saved' : 'courses.lessons.created', { title: latest.title }),
    );
    onClose();
  };

  const updateLink = (key: string, change: Partial<LinkRow>) =>
    setLinks((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const addLink = () => {
    nextKey.current += 1;
    setLinks((rows) => [
      ...rows,
      { key: `new-${nextKey.current}`, label: '', url: '', kind: 'file' },
    ]);
    setInvalid(new Map());
  };
  const removeLink = (key: string) => {
    setLinks((rows) => rows.filter((row) => row.key !== key));
    // os erros são por posição: sem a linha, deixam de valer
    setInvalid(new Map());
    saveLinks.reset();
  };

  const linkName = (link: LinkRow) =>
    link.label.trim() || t('courses.lessons.links.unnamed', { position: links.indexOf(link) + 1 });
  const generalLesson = lessonRefusal.general(['title', 'videoUrl', 'durationSeconds']);
  const generalLinks =
    Boolean(saveLinks.error) &&
    !links.some((_, index) =>
      ['label', 'url', 'kind'].some((field) => linkRefused.has(`links.${index}.${field}`)),
    );

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={initial ? t('courses.lessons.editTitle') : t('courses.lessons.newTitle')}
      description={
        moduleTitle ? t('courses.lessons.newDescription', { module: moduleTitle }) : undefined
      }
      closeLabel={t('common.close')}
      dismissible={!busy}
      footer={
        <>
          <AdminButton disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? t('common.saving') : initial ? t('common.save') : t('courses.lessons.create')}
          </AdminButton>
        </>
      }
    >
      {generalLesson ? (
        <Alert tone="error" className="mb-4">
          {message(saveLesson.error)}
        </Alert>
      ) : null}
      {generalLinks ? (
        <Alert tone="error" className="mb-4" title={t('courses.lessons.links.saveError')}>
          {message(saveLinks.error)}
        </Alert>
      ) : null}
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('courses.fields.title')}
          value={title}
          onChange={setTitle}
          maxLength={TITLE_MAX}
          autoComplete="off"
          error={fieldError('title')}
        />
        <AdminField
          label={t('courses.lessons.videoUrl')}
          hint={t('courses.lessons.videoUrlHint')}
          type="url"
          value={videoUrl}
          onChange={setVideoUrl}
          maxLength={URL_MAX}
          autoComplete="off"
          error={fieldError('videoUrl')}
        />
        <AdminField
          label={t('courses.lessons.duration')}
          hint={t('courses.lessons.durationHint')}
          value={duration}
          onChange={setDuration}
          maxLength={10}
          inputMode="numeric"
          autoComplete="off"
          error={fieldError('durationSeconds')}
        />
        <AdminTextArea
          label={t('courses.fields.description')}
          hint={t('courses.fields.markdownHint')}
          value={description}
          onChange={setDescription}
          rows={5}
          maxLength={DESCRIPTION_MAX}
          counter={({ length, max }) => t('courses.counter', { length, max })}
          error={fieldError('description')}
        />
        <div className="flex flex-col gap-1">
          <AdminSwitch checked={isSample} onChange={setIsSample}>
            {t('courses.lessons.sample')}
          </AdminSwitch>
          <span className="text-sm text-ink-3">{t('courses.lessons.sampleHint')}</span>
        </div>

        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium text-ink">
            {t('courses.lessons.links.title')}
          </legend>
          <span className="text-sm text-ink-3">
            {t('courses.lessons.links.hint', { max: LESSON_LINKS_MAX })}
          </span>
          {links.length > 0 ? (
            <SortableList
              aria-label={t('courses.lessons.links.title')}
              items={links}
              getId={(link) => link.key}
              getLabel={linkName}
              onReorder={(next) => {
                setLinks(next);
                setInvalid(new Map());
                saveLinks.reset();
              }}
              labels={labels}
              disabled={busy}
              renderItem={(link, index) => (
                <div className="flex w-full flex-wrap items-start gap-2">
                  <AdminField
                    className="min-w-40 flex-1"
                    label={t('courses.lessons.links.label')}
                    value={link.label}
                    onChange={(value: string) => updateLink(link.key, { label: value })}
                    maxLength={TITLE_MAX}
                    autoComplete="off"
                    error={fieldError(`links.${index}.label`)}
                  />
                  <AdminField
                    className="min-w-52 flex-[2]"
                    label={t('courses.lessons.links.url')}
                    type="url"
                    value={link.url}
                    onChange={(value: string) => updateLink(link.key, { url: value })}
                    maxLength={URL_MAX}
                    autoComplete="off"
                    error={fieldError(`links.${index}.url`)}
                  />
                  <div className="flex items-center gap-1 self-end">
                    <AdminMenu
                      options={LINK_KINDS.map((id) => ({
                        id,
                        label: t(`courses.lessons.links.kinds.${id}`),
                      }))}
                      value={link.kind}
                      onChange={(id: LessonLinkKind) => updateLink(link.key, { kind: id })}
                      aria-label={t('courses.lessons.links.kindLabel', {
                        name: linkName(link),
                        value: t(`courses.lessons.links.kinds.${link.kind}`),
                      })}
                    />
                    <AdminButton
                      variant="ghost"
                      aria-label={t('courses.lessons.links.removeOf', { name: linkName(link) })}
                      onClick={() => removeLink(link.key)}
                    >
                      {t('courses.lessons.links.remove')}
                    </AdminButton>
                  </div>
                </div>
              )}
            />
          ) : null}
          <div>
            <AdminButton disabled={busy || links.length >= LESSON_LINKS_MAX} onClick={addLink}>
              {t('courses.lessons.links.add')}
            </AdminButton>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
