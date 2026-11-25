import {
  AdminButton,
  AdminEmpty,
  AdminField,
  AdminSection,
  AdminStatus,
  AdminTag,
  Alert,
  Dialog,
  SortableList,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  type CourseDetail,
  type CourseModule,
  type LessonSummary,
  refreshCourse,
  setModulesOrder,
  TITLE_MAX,
} from '../../api/courses';
import { ConfirmAction, useSortableLabels } from './CourseBits';
import { useCourseError, useFieldRefusal } from './errors';
import { formatDuration } from './format';
import { LessonDialog } from './LessonDialog';

/** Parâmetro do endereço com a aula aberta no diálogo (`/cursos/:id?aula=<id>`). */
export const LESSON_PARAM = 'aula';

type DialogState =
  | { kind: 'module-new' }
  | { kind: 'module-rename'; module: CourseModule }
  | { kind: 'module-delete'; module: CourseModule }
  | { kind: 'lesson-new'; module: CourseModule }
  | { kind: 'lesson-delete'; lesson: LessonSummary };

interface Props {
  course: CourseDetail;
  /** Se a sessão publica e despublica aulas deste curso (spec 009, "Autoria"). */
  canPublish: boolean;
}

/**
 * Módulos e aulas do curso (spec 009, RF-01 e RF-08): criar, renomear, excluir e reordenar por
 * arrastar ou pelo teclado. A ordem nova vai inteira para a API (`PUT .../order`); se ela
 * recusar, o editor busca o curso de novo.
 */
export function CourseContentTab({ course, canPublish }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useCourseError();
  const labels = useSortableLabels();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = () => setDialog(null);
  const op = useAction(async (run: () => Promise<void>) => run());

  const lessonId = params.get(LESSON_PARAM);
  const openLesson = (id: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set(LESSON_PARAM, id);
      else next.delete(LESSON_PARAM);
      return next;
    });
  };

  /** Roda uma escrita; a recusa vira aviso e o curso é lido de novo. */
  const write = async (run: () => Promise<void>, title: string) => {
    const result = await op.run(run);
    if (!result.ok) {
      toast.error(message(result.error), { title });
      await refreshCourse(queryClient, course.id);
    }
  };

  const reorderModules = (next: CourseModule[]) => {
    setModulesOrder(queryClient, course.id, next);
    void write(async () => {
      await api.PUT('/api/v1/courses/{id}/modules/order', {
        params: { path: { id: course.id } },
        body: { moduleIds: next.map((module) => module.id) },
      });
    }, t('courses.modules.reorderError'));
  };

  const reorderLessons = (module: CourseModule, next: LessonSummary[]) => {
    setModulesOrder(
      queryClient,
      course.id,
      course.modules.map((item) => (item.id === module.id ? { ...item, lessons: next } : item)),
    );
    void write(async () => {
      await api.PUT('/api/v1/modules/{id}/lessons/order', {
        params: { path: { id: module.id } },
        body: { lessonIds: next.map((lesson) => lesson.id) },
      });
    }, t('courses.lessons.reorderError'));
  };

  const setLessonStatus = (lesson: LessonSummary, status: LessonSummary['status']) =>
    void write(
      async () => {
        await api.PATCH('/api/v1/lessons/{id}', {
          params: { path: { id: lesson.id } },
          body: { status },
        });
        await refreshCourse(queryClient, course.id);
        toast.success(
          t(status === 'published' ? 'courses.lessons.published' : 'courses.lessons.unpublished', {
            title: lesson.title,
          }),
        );
      },
      t(status === 'published' ? 'courses.lessons.publishError' : 'courses.lessons.unpublishError'),
    );

  const lessonRow = (lesson: LessonSummary) => (
    <div className="flex w-full flex-wrap items-center gap-2">
      <button type="button" className="nuva-linkbutton" onClick={() => openLesson(lesson.id)}>
        {lesson.title}
      </button>
      <AdminStatus tone={lesson.status === 'published' ? 'green' : 'gray'}>
        {t(`courses.lessons.status.${lesson.status}`)}
      </AdminStatus>
      {lesson.isSample ? <AdminTag>{t('courses.lessons.sample')}</AdminTag> : null}
      {lesson.durationSeconds !== null ? (
        <span className="text-sm text-ink-3">{formatDuration(lesson.durationSeconds)}</span>
      ) : null}
      <span className="ml-auto flex flex-wrap items-center gap-1">
        {canPublish ? (
          lesson.status === 'published' ? (
            <AdminButton
              size="sm"
              disabled={op.busy}
              aria-label={t('courses.lessons.unpublishOf', { title: lesson.title })}
              onClick={() => setLessonStatus(lesson, 'draft')}
            >
              {t('courses.lessons.unpublish')}
            </AdminButton>
          ) : (
            <AdminButton
              size="sm"
              disabled={op.busy}
              aria-label={t('courses.lessons.publishOf', { title: lesson.title })}
              onClick={() => setLessonStatus(lesson, 'published')}
            >
              {t('courses.lessons.publish')}
            </AdminButton>
          )
        ) : null}
        <AdminButton
          size="sm"
          variant="ghost"
          aria-label={t('courses.lessons.deleteOf', { title: lesson.title })}
          onClick={() => setDialog({ kind: 'lesson-delete', lesson })}
        >
          {t('courses.lessons.delete')}
        </AdminButton>
      </span>
    </div>
  );

  const moduleRow = (module: CourseModule) => (
    <div className="flex w-full flex-col gap-2 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-base font-semibold text-ink">{module.title}</h3>
        <span className="text-sm text-ink-3">
          {t('courses.lessonTotal', { count: module.lessons.length })}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <AdminButton
            size="sm"
            aria-label={t('courses.lessons.newIn', { title: module.title })}
            onClick={() => setDialog({ kind: 'lesson-new', module })}
          >
            {t('courses.lessons.new')}
          </AdminButton>
          <AdminButton
            size="sm"
            variant="ghost"
            aria-label={t('courses.modules.renameOf', { title: module.title })}
            onClick={() => setDialog({ kind: 'module-rename', module })}
          >
            {t('courses.modules.rename')}
          </AdminButton>
          {module.lessons.length === 0 ? (
            <AdminButton
              size="sm"
              variant="ghost"
              aria-label={t('courses.modules.deleteOf', { title: module.title })}
              onClick={() => setDialog({ kind: 'module-delete', module })}
            >
              {t('courses.modules.delete')}
            </AdminButton>
          ) : null}
        </span>
      </div>
      {module.lessons.length > 0 ? (
        <SortableList
          aria-label={t('courses.lessons.listOf', { title: module.title })}
          items={module.lessons}
          getId={(lesson) => lesson.id}
          getLabel={(lesson) => lesson.title}
          renderItem={lessonRow}
          onReorder={(next) => reorderLessons(module, next)}
          labels={labels}
          disabled={op.busy}
        />
      ) : (
        <p className="m-0 text-sm text-ink-3">{t('courses.lessons.empty')}</p>
      )}
    </div>
  );

  return (
    <AdminSection
      title={t('courses.modules.title')}
      actions={
        <AdminButton onClick={() => setDialog({ kind: 'module-new' })}>
          {t('courses.modules.new')}
        </AdminButton>
      }
    >
      {course.modules.length === 0 ? (
        <AdminEmpty
          icon={<Layers aria-hidden="true" />}
          title={t('courses.modules.empty')}
          text={t('courses.modules.emptyText')}
        >
          <AdminButton variant="primary" onClick={() => setDialog({ kind: 'module-new' })}>
            {t('courses.modules.new')}
          </AdminButton>
        </AdminEmpty>
      ) : (
        <SortableList
          aria-label={t('courses.modules.list')}
          items={course.modules}
          getId={(module) => module.id}
          getLabel={(module) => module.title}
          renderItem={moduleRow}
          onReorder={reorderModules}
          labels={labels}
          disabled={op.busy}
        />
      )}

      {dialog?.kind === 'module-new' || dialog?.kind === 'module-rename' ? (
        <ModuleDialog
          courseId={course.id}
          module={dialog.kind === 'module-rename' ? dialog.module : null}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'module-delete' ? (
        <ConfirmAction
          destructive
          title={t('courses.modules.deleteTitle')}
          itemName={dialog.module.title}
          message={t('courses.modules.deleteText')}
          confirmLabel={t('courses.modules.delete')}
          busyLabel={t('courses.deleting')}
          action={async () => {
            await api.DELETE('/api/v1/modules/{id}', {
              params: { path: { id: dialog.module.id } },
            });
          }}
          onClose={close}
          onDone={() => {
            void refreshCourse(queryClient, course.id);
            toast.success(t('courses.modules.deleted', { title: dialog.module.title }));
          }}
        />
      ) : null}
      {dialog?.kind === 'lesson-delete' ? (
        <ConfirmAction
          destructive
          title={t('courses.lessons.deleteTitle')}
          itemName={dialog.lesson.title}
          message={t('courses.lessons.deleteText')}
          confirmLabel={t('courses.lessons.delete')}
          busyLabel={t('courses.deleting')}
          action={async () => {
            await api.DELETE('/api/v1/lessons/{id}', {
              params: { path: { id: dialog.lesson.id } },
            });
          }}
          onClose={close}
          onDone={() => {
            void refreshCourse(queryClient, course.id);
            toast.success(t('courses.lessons.deleted', { title: dialog.lesson.title }));
          }}
        />
      ) : null}
      {dialog?.kind === 'lesson-new' ? (
        <LessonDialog
          courseId={course.id}
          moduleId={dialog.module.id}
          moduleTitle={dialog.module.title}
          lessonId={null}
          onClose={close}
        />
      ) : null}
      {lessonId && !dialog ? (
        <LessonDialog
          key={lessonId}
          courseId={course.id}
          moduleId={null}
          moduleTitle={null}
          lessonId={lessonId}
          onClose={() => openLesson(null)}
        />
      ) : null}
    </AdminSection>
  );
}

interface ModuleDialogProps {
  courseId: string;
  /** Módulo a renomear; `null` cria um novo ao fim do curso. */
  module: CourseModule | null;
  onClose: () => void;
}

/** Criar (`POST /courses/{id}/modules`) ou renomear (`PATCH /modules/{id}`) um módulo. */
function ModuleDialog({ courseId, module, onClose }: ModuleDialogProps) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useCourseError();
  const [title, setTitle] = useState(module?.title ?? '');
  const [missing, setMissing] = useState(false);

  const save = useAction(async () => {
    const body = { title: title.trim() };
    if (module) {
      await api.PATCH('/api/v1/modules/{id}', { params: { path: { id: module.id } }, body });
    } else {
      await api.POST('/api/v1/courses/{id}/modules', { params: { path: { id: courseId } }, body });
    }
  });
  const refusal = useFieldRefusal(save.error);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = title.trim() === '';
    setMissing(empty);
    if (empty) return;
    const result = await save.run();
    if (!result.ok) return;
    await refreshCourse(queryClient, courseId);
    toast.success(
      t(module ? 'courses.modules.renamed' : 'courses.modules.created', { title: title.trim() }),
    );
    onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={module ? t('courses.modules.renameTitle') : t('courses.modules.newTitle')}
      closeLabel={t('common.close')}
      dismissible={!save.busy}
      footer={
        <>
          <AdminButton disabled={save.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={save.busy}>
            {save.busy
              ? t('common.saving')
              : module
                ? t('common.save')
                : t('courses.modules.create')}
          </AdminButton>
        </>
      }
    >
      {refusal.general(['title']) ? (
        <Alert tone="error" className="mb-4">
          {message(save.error)}
        </Alert>
      ) : null}
      <form id={formId} noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('courses.modules.name')}
          value={title}
          onChange={setTitle}
          maxLength={TITLE_MAX}
          autoComplete="off"
          error={missing ? t('forms.required') : refusal.of('title')}
        />
      </form>
    </Dialog>
  );
}
