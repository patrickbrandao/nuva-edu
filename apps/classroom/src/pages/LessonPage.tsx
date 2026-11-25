import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminTag,
  Alert,
  ErrorState,
  LoadingState,
  Markdown,
  PageTitle,
  ProgressBar,
  safeMarkdownUrl,
  Tabs,
  TextLink,
  useToast,
  VideoPlayer,
} from '@nuva-edu/ui';
import { ChevronLeft, ChevronRight, CircleCheck, Lock, PackageSearch } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { describeError } from '../api/errors';
import { formatDuration, productPath } from '../catalog/format';
import { CourseProgram } from '../learning/CourseProgram';
import { type CourseView, coursePath, lessonPath, UNDO_MS } from '../learning/progress';
import {
  type AccessDenialReason,
  type LessonView,
  useCourseView,
  useLesson,
  useLessonCompletion,
  useSavePosition,
} from '../learning/queries';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';

/** Lateral: progresso do curso e o programa, com o estado de cada aula. */
function ProgramAside({ course, lessonId }: { course: CourseView; lessonId: string }) {
  const { t } = useTranslation();
  const { progress } = course;
  const counts = { completed: progress.completedLessons, count: progress.totalLessons };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="lesson-program-title">
      <h2 id="lesson-program-title" className="m-0 text-base font-semibold text-ink">
        {t('learning.lesson.courseProgram')}
      </h2>
      <ProgressBar
        size="sm"
        value={progress.percent}
        label={t('learning.progress.course')}
        valueText={t('learning.progress.lessonsDone', counts)}
        caption={t('learning.progress.percent', { percent: progress.percent })}
      />
      <CourseProgram course={course} currentLessonId={lessonId} headingLevel={3} />
    </section>
  );
}

/** Aba Materiais: links de apoio e ebooks vinculados à aula. */
function Materials({ lesson }: { lesson: LessonView }) {
  const { t } = useTranslation();
  // só endereço `http(s)` ou `mailto` vira link; outro protocolo fica de fora
  const links = lesson.links
    .map((link) => ({ ...link, url: safeMarkdownUrl(link.url) }))
    .filter((link) => link.url !== '')
    .sort((a, b) => a.position - b.position);
  if (links.length === 0 && lesson.ebooks.length === 0) {
    return <p className="m-0 text-sm text-ink-3">{t('learning.lesson.materialsEmpty')}</p>;
  }
  return (
    <div className="flex flex-col gap-4 text-sm text-ink">
      {links.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">{t('learning.lesson.links')}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <TextLink href={link.url} external newTabLabel={t('common.newTab')}>
                  {link.label}
                </TextLink>
                <AdminTag>{t(`learning.lesson.linkKinds.${link.kind}`)}</AdminTag>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {lesson.ebooks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">{t('learning.lesson.ebooks')}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {lesson.ebooks.map((ebook) => (
              <li key={ebook.id}>
                <TextLink href={productPath('ebook', ebook.slug)}>{ebook.title}</TextLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** A aula aberta: player, abas e rodapé. Montada de novo a cada aula (`key`). */
function LessonBody({ lesson }: { lesson: LessonView }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const slug = lesson.course.slug;
  const completion = useLessonCompletion(slug);
  const savePosition = useSavePosition();
  const [videoFailed, setVideoFailed] = useState(false);
  // a posição gravada vale na abertura; as seguintes saem do próprio player
  const [startAt] = useState(lesson.userState.positionSeconds);

  const videoHref = lesson.videoUrl ? safeMarkdownUrl(lesson.videoUrl) : '';

  const completed = lesson.userState.completedAt !== null;
  const setCompleted = completion.mutate;

  // Fim do vídeo (os provedores que o informam; `link` nunca chega aqui): conclui e oferece desfazer.
  const onEnded = () => {
    if (completed) return;
    setCompleted({ lessonId: lesson.id, completed: true, via: 'video_end' });
    toast.success(t('learning.lesson.autoCompleted'), {
      id: `lesson-done-${lesson.id}`,
      duration: UNDO_MS,
      action: {
        label: t('learning.lesson.undo'),
        onClick: () => setCompleted({ lessonId: lesson.id, completed: false }),
      },
    });
  };

  const finishCourse = () => {
    if (!completed) setCompleted({ lessonId: lesson.id, completed: true, via: 'manual' });
    void navigate(coursePath(slug));
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          <TextLink href={coursePath(slug)}>{lesson.course.title}</TextLink>
          <span aria-hidden="true">·</span>
          <span>{lesson.module.title}</span>
        </p>
        <PageTitle>{lesson.title}</PageTitle>
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
          {lesson.durationSeconds ? <span>{formatDuration(t, lesson.durationSeconds)}</span> : null}
          {lesson.isSample ? <AdminTag>{t('learning.lesson.sample')}</AdminTag> : null}
          {completed ? (
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              <CircleCheck size={14} aria-hidden="true" />
              {t('learning.lesson.done')}
            </span>
          ) : null}
        </p>
      </header>

      {lesson.videoUrl && lesson.videoProvider ? (
        <>
          <VideoPlayer
            src={lesson.videoUrl}
            provider={lesson.videoProvider}
            startAt={startAt}
            duration={lesson.durationSeconds}
            onEnded={onEnded}
            onTime={(seconds) => savePosition(lesson.id, seconds)}
            onError={() => setVideoFailed(true)}
            locale={i18n.language}
            labels={{
              title: lesson.title,
              openVideo: t('learning.player.openVideo'),
              newTab: t('common.newTab'),
              controls: t('learning.player.controls'),
              rewind: t('learning.player.rewind'),
              forward: t('learning.player.forward'),
              speed: t('learning.player.speed'),
              volume: t('learning.player.volume'),
              fullscreen: t('learning.player.fullscreen'),
              pictureInPicture: t('learning.player.pictureInPicture'),
            }}
          />
          {videoFailed ? (
            <Alert
              tone="error"
              title={t('learning.lesson.videoErrorTitle')}
              actions={
                videoHref ? (
                  <AdminButton href={videoHref} target="_blank" rel="noopener noreferrer">
                    {t('learning.lesson.openInNewTab')}
                    <span className="sr-only"> {t('common.newTab')}</span>
                  </AdminButton>
                ) : undefined
              }
            >
              {t('learning.lesson.videoErrorText')}
            </Alert>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-sm text-ink-3">{t('learning.lesson.noVideo')}</p>
      )}

      <Tabs
        label={t('learning.lesson.tabs.label')}
        tabs={[
          {
            id: 'about',
            label: t('learning.lesson.tabs.about'),
            content: lesson.description?.trim() ? (
              <Markdown newTabLabel={t('common.newTab')}>{lesson.description}</Markdown>
            ) : (
              <p className="m-0 text-sm text-ink-3">{t('learning.lesson.aboutEmpty')}</p>
            ),
          },
          {
            id: 'materials',
            label: t('learning.lesson.tabs.materials'),
            count: lesson.links.length + lesson.ebooks.length || undefined,
            content: <Materials lesson={lesson} />,
          },
        ]}
      />

      <nav
        aria-label={t('learning.lesson.navigation')}
        className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-line pt-4"
      >
        {lesson.previousLessonId ? (
          <AdminButton
            href={lessonPath(slug, lesson.previousLessonId)}
            icon={<ChevronLeft aria-hidden="true" />}
          >
            {t('learning.lesson.previous')}
          </AdminButton>
        ) : (
          <span />
        )}
        <AdminButton
          variant={completed || lesson.isLastLesson ? 'default' : 'primary'}
          onClick={() =>
            setCompleted({ lessonId: lesson.id, completed: !completed, via: 'manual' })
          }
        >
          {completed ? t('learning.lesson.unmarkDone') : t('learning.lesson.markDone')}
        </AdminButton>
        {lesson.isLastLesson ? (
          <AdminButton variant="primary" onClick={finishCourse}>
            {t('learning.lesson.finishCourse')}
          </AdminButton>
        ) : lesson.nextLessonId ? (
          <AdminButton
            href={lessonPath(slug, lesson.nextLessonId)}
            iconEnd={<ChevronRight aria-hidden="true" />}
          >
            {t('learning.lesson.next')}
          </AdminButton>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

/** Sem acesso: no lugar do player, o motivo e o caminho até a página do curso (spec 010). */
function LockedLesson({
  slug,
  title,
  reason,
}: {
  slug: string;
  title: string | undefined;
  reason: AccessDenialReason | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageTitle>{title ?? t('learning.lesson.lockedTitle')}</PageTitle>
      <AdminCard pad>
        <AdminEmpty
          icon={<Lock aria-hidden="true" />}
          title={t('learning.lesson.lockedTitle')}
          text={t(`learning.reasons.${reason ?? 'unknown'}`)}
        >
          <span className="mt-3 flex flex-wrap justify-center gap-2">
            <AdminButton href={productPath('course', slug)} variant="primary">
              {t('learning.course.publicPage')}
            </AdminButton>
            <AdminButton href={coursePath(slug)}>{t('learning.lesson.backToCourse')}</AdminButton>
          </span>
        </AdminEmpty>
      </AdminCard>
    </div>
  );
}

function LessonContent() {
  const { t } = useTranslation();
  const { slug = '', aula: lessonId = '' } = useParams();
  const lessonQuery = useLesson(lessonId);
  const courseQuery = useCourseView(slug);
  const result = lessonQuery.data;
  const course = courseQuery.data ?? null;
  const lesson = result?.kind === 'ok' ? result.lesson : null;
  const listed = course?.modules
    .flatMap((module) => module.lessons)
    .find((item) => item.id === lessonId);

  usePageMeta(
    lesson?.title ??
      listed?.title ??
      (result?.kind === 'missing' ? t('learning.lesson.notFoundTitle') : t('pages.lesson')),
    lesson
      ? t('learning.lesson.description', { lesson: lesson.title, course: lesson.course.title })
      : t('learning.lesson.notFoundText'),
  );

  // a aula mora num só curso: endereço com outro curso vai para o certo
  if (lesson && lesson.course.slug !== slug) {
    return <Navigate to={lessonPath(lesson.course.slug, lesson.id)} replace />;
  }

  let main: ReactNode;
  if (lessonQuery.isPending) {
    main = (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('learning.lesson.loading')} />
      </AdminCard>
    );
  } else if (lessonQuery.isError || !result) {
    const failure = describeError(t, lessonQuery.error);
    main = (
      <AdminCard pad>
        <ErrorState
          title={t('learning.lesson.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void lessonQuery.refetch()}
          retrying={lessonQuery.isFetching}
        />
      </AdminCard>
    );
  } else if (result.kind === 'missing') {
    main = (
      <>
        <PageTitle align="center">{t('learning.lesson.notFoundTitle')}</PageTitle>
        <AdminEmpty
          icon={<PackageSearch aria-hidden="true" />}
          text={t('learning.lesson.notFoundText')}
        >
          <span className="mt-3 flex">
            <AdminButton href={coursePath(slug)}>{t('learning.lesson.backToCourse')}</AdminButton>
          </span>
        </AdminEmpty>
      </>
    );
  } else if (result.kind === 'denied') {
    main = <LockedLesson slug={slug} title={listed?.title} reason={result.reason} />;
  } else {
    main = <LessonBody key={result.lesson.id} lesson={result.lesson} />;
  }

  const showAside = course !== null && result !== undefined && result.kind !== 'missing';
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div
        className={
          showAside ? 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start' : undefined
        }
      >
        <div className="flex min-w-0 flex-col gap-4">{main}</div>
        {showAside && course ? <ProgramAside course={course} lessonId={lessonId} /> : null}
      </div>
    </div>
  );
}

/**
 * `/meus-cursos/:slug/aulas/:aula` (`:aula` é o id da aula): player, abas Sobre e Materiais,
 * programa ao lado, navegação e conclusão (spec 014). As abas Minhas notas e Comentários e o
 * "Reportar problema" chegam com as specs 016, 017 e 023.
 */
export function LessonPage() {
  return <RequireSession>{() => <LessonContent />}</RequireSession>;
}
