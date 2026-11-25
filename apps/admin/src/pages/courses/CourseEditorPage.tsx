import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminEmpty,
  AdminPageHeader,
  AdminTabs,
  Alert,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  COURSES_PATH,
  type CourseDetail,
  courseChanged,
  coursesKeys,
  useCourse,
} from '../../api/courses';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { useCan, useSession } from '../../session/session';
import { usePageCrumb } from '../../shell/crumbs';
import { CourseStudentsTab } from '../access/CourseStudentsTab';
import { ConfirmAction, CourseStatusCell } from './CourseBits';
import { CourseCertificateTab } from './CourseCertificateTab';
import { CourseContentTab, LESSON_PARAM } from './CourseContentTab';
import { CourseDataTab } from './CourseDataTab';
import { CourseEbooksTab } from './CourseEbooksTab';
import { useCourseError } from './errors';

const TABS = ['dados', 'conteudo', 'ebooks', 'certificado', 'alunos'] as const;
type TabId = (typeof TABS)[number];
const TAB_PARAM = 'aba';

type ConfirmName = 'publish' | 'unpublish' | 'archive' | 'unarchive' | 'delete';
type CourseAction = Exclude<ConfirmName, 'delete'> | 'request-review';

/**
 * Editor de curso (spec 006, mapa de telas; spec 009): dados e capa, módulos e aulas,
 * certificado, e as ações de publicação. Curso alheio ao instrutor responde `404` na API e
 * aparece aqui como "não encontrado".
 */
export function CourseEditorPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const course = useCourse(id);
  usePageCrumb(course.data?.title);

  if (course.isPending) return <LoadingState label={t('courses.editor.loading')} />;
  if (course.isError && !course.data) {
    if (isApiError(course.error) && course.error.status === 404) {
      return (
        <AdminEmpty
          icon={<SearchX aria-hidden="true" />}
          title={t('courses.editor.notFound')}
          text={t('courses.editor.notFoundText')}
        >
          <AdminButton href={COURSES_PATH}>{t('courses.editor.backToList')}</AdminButton>
        </AdminEmpty>
      );
    }
    return (
      <QueryErrorState
        error={course.error}
        title={t('courses.editor.errorTitle')}
        onRetry={() => void course.refetch()}
        retrying={course.isFetching}
      />
    );
  }
  return <CourseEditor course={course.data} />;
}

function CourseEditor({ course }: { course: CourseDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const can = useCan();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const message = useCourseError();
  const [params, setParams] = useSearchParams();
  const [confirm, setConfirm] = useState<ConfirmName | null>(null);
  const close = () => setConfirm(null);

  // a ação parcial (◐) vem na lista do instrutor: o que ele não alcança sai pelo papel (spec 008)
  const instructor = session.user.role === 'instructor';
  const archived = course.archivedAt !== null;
  const published = course.status === 'published';
  const canPublish = can('course.publish') && (!instructor || course.accessMode === 'open');
  const canArchive = can('product.archive');
  // "Excluir" só sem vínculos (spec 009): com alunos, o caminho é arquivar; a API confere o resto
  const canDelete = can('course.delete') && course.studentCount === 0;

  // vincular ebooks é de quem tem `ebook.link`, e ver os alunos, de quem tem `progress.view`;
  // sem a ação, a aba nem aparece
  const tabs = TABS.filter(
    (item) =>
      (item !== 'ebooks' || can('ebook.link')) && (item !== 'alunos' || can('progress.view')),
  );
  const requested = params.get(TAB_PARAM);
  // endereço com a aula aberta cai na aba do conteúdo
  const tab: TabId =
    tabs.find((item) => item === requested) ?? (params.has(LESSON_PARAM) ? 'conteudo' : 'dados');
  const selectTab = (next: TabId) =>
    setParams(next === 'dados' ? {} : { [TAB_PARAM]: next }, { replace: true });

  const post = async (action: CourseAction): Promise<CourseDetail> => {
    const { data } = await api.POST(`/api/v1/courses/{id}/${action}`, {
      params: { path: { id: course.id } },
    });
    if (!data) throw new Error(`POST /api/v1/courses/{id}/${action} respondeu sem corpo`);
    return data;
  };

  const review = useAction(async (request: boolean): Promise<CourseDetail> => {
    if (request) return post('request-review');
    const { data } = await api.DELETE('/api/v1/courses/{id}/request-review', {
      params: { path: { id: course.id } },
    });
    if (!data) throw new Error('DELETE /api/v1/courses/{id}/request-review respondeu sem corpo');
    return data;
  });
  const setReview = async (request: boolean) => {
    const result = await review.run(request);
    if (result.ok) {
      courseChanged(queryClient, result.data);
      toast.success(t(request ? 'courses.review.requested' : 'courses.review.cancelled'));
    } else {
      toast.error(message(result.error), { title: t('courses.review.error') });
    }
  };

  const done = (text: string) => (result: CourseDetail) => {
    courseChanged(queryClient, result);
    toast.success(text);
  };

  const actions = (
    <>
      {!archived && !published && canPublish ? (
        <AdminButton variant="primary" onClick={() => setConfirm('publish')}>
          {t('courses.publish.open')}
        </AdminButton>
      ) : null}
      {!archived && !published && !canPublish && can('course.edit') ? (
        course.reviewRequestedAt ? (
          <AdminButton disabled={review.busy} onClick={() => void setReview(false)}>
            {t('courses.review.cancel')}
          </AdminButton>
        ) : (
          <AdminButton
            variant="primary"
            disabled={review.busy}
            onClick={() => void setReview(true)}
          >
            {t('courses.review.request')}
          </AdminButton>
        )
      ) : null}
      {!archived && published && canPublish ? (
        <AdminButton onClick={() => setConfirm('unpublish')}>
          {t('courses.unpublish.open')}
        </AdminButton>
      ) : null}
      {canArchive ? (
        archived ? (
          <AdminButton onClick={() => setConfirm('unarchive')}>
            {t('courses.unarchive.open')}
          </AdminButton>
        ) : (
          <AdminButton onClick={() => setConfirm('archive')}>
            {t('courses.archive.open')}
          </AdminButton>
        )
      ) : null}
      {canDelete ? (
        <AdminButton onClick={() => setConfirm('delete')}>{t('courses.delete.open')}</AdminButton>
      ) : null}
    </>
  );

  return (
    <>
      <AdminPageHeader
        title={course.title}
        subtitle={<CourseStatusCell course={course} />}
        actions={actions}
      />
      {archived ? (
        <Alert tone="warning" className="mb-4" title={t('courses.archive.noticeTitle')}>
          {t('courses.archive.notice', { date: formatDateTime(course.archivedAt) })}
        </Alert>
      ) : course.reviewRequestedAt ? (
        <Alert tone="info" className="mb-4" title={t('courses.awaitingReview')}>
          {t(canPublish ? 'courses.review.noticeStaff' : 'courses.review.notice', {
            date: formatDateTime(course.reviewRequestedAt),
          })}
        </Alert>
      ) : null}
      <AdminTabs
        className="mb-4"
        label={t('courses.editor.tabsLabel')}
        tabs={tabs.map((item) => ({ id: item, label: t(`courses.editor.tabs.${item}`) }))}
        value={tab}
        onChange={selectTab}
      />
      {tab === 'dados' ? (
        <CourseDataTab
          course={course}
          canSetAccess={can('product.set_access') && !instructor}
          canSetPrice={can('product.set_price')}
        />
      ) : tab === 'conteudo' ? (
        <CourseContentTab course={course} canPublish={canPublish} />
      ) : tab === 'ebooks' ? (
        <CourseEbooksTab course={course} />
      ) : tab === 'certificado' ? (
        <CourseCertificateTab course={course} />
      ) : (
        <CourseStudentsTab course={course} />
      )}

      {confirm === 'publish' ? (
        <ConfirmAction
          title={t('courses.publish.title')}
          itemName={course.title}
          message={t('courses.publish.text')}
          confirmLabel={t('courses.publish.open')}
          busyLabel={t('courses.publish.busy')}
          action={() => post('publish')}
          onClose={close}
          onDone={done(t('courses.publish.done'))}
        />
      ) : null}
      {confirm === 'unpublish' ? (
        <ConfirmAction
          destructive
          title={t('courses.unpublish.title')}
          itemName={course.title}
          message={t('courses.unpublish.text', { count: course.studentCount })}
          confirmLabel={t('courses.unpublish.open')}
          busyLabel={t('courses.unpublish.busy')}
          action={() => post('unpublish')}
          onClose={close}
          onDone={done(t('courses.unpublish.done'))}
        />
      ) : null}
      {confirm === 'archive' ? (
        <ConfirmAction
          destructive
          title={t('courses.archive.title')}
          itemName={course.title}
          message={t('courses.archive.text', { count: course.studentCount })}
          confirmLabel={t('courses.archive.open')}
          busyLabel={t('courses.archive.busy')}
          action={() => post('archive')}
          onClose={close}
          onDone={done(t('courses.archive.done'))}
        />
      ) : null}
      {confirm === 'unarchive' ? (
        <ConfirmAction
          title={t('courses.unarchive.title')}
          itemName={course.title}
          message={t('courses.unarchive.text')}
          confirmLabel={t('courses.unarchive.open')}
          busyLabel={t('courses.unarchive.busy')}
          action={() => post('unarchive')}
          onClose={close}
          onDone={done(t('courses.unarchive.done'))}
        />
      ) : null}
      {confirm === 'delete' ? (
        <ConfirmAction
          destructive
          title={t('courses.delete.title')}
          itemName={course.title}
          message={t('courses.delete.text')}
          confirmLabel={t('courses.delete.open')}
          busyLabel={t('courses.deleting')}
          action={async () => {
            await api.DELETE('/api/v1/courses/{id}', { params: { path: { id: course.id } } });
          }}
          onClose={close}
          onDone={() => {
            toast.success(t('courses.delete.done', { title: course.title }));
            void navigate(COURSES_PATH);
            void queryClient.invalidateQueries({ queryKey: coursesKeys.lists() });
          }}
        />
      ) : null}
    </>
  );
}
