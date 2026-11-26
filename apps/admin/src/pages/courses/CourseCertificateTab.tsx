import { AdminButton, AdminField, AdminSection, AdminSwitch, Alert, useToast } from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { type CourseDetail, courseChanged, refreshCourse } from '../../api/courses';
import { ConflictAlert } from './CourseBits';
import { useCourseError, useFieldRefusal } from './errors';
import { parseWhole } from './format';
import { isVersionConflict, useEditedForm } from './version';

const HOURS_MAX = 10000;

const formOf = (course: CourseDetail) => ({
  enabled: course.certificateEnabled,
  hours: course.certificateHours === null ? '' : String(course.certificateHours),
});

/**
 * Certificado do curso (spec 015): habilitar e fixar a carga horária (`PATCH /courses/{id}`,
 * `course.edit`, com o `version` do curso e só o que mudou). O template do certificado tem aba
 * própria (tarefa 467).
 */
export function CourseCertificateTab({ course }: { course: CourseDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useCourseError();
  const [form, setForm] = useEditedForm(course, formOf);
  const { enabled, hours } = form;
  const setEnabled = (value: boolean) => setForm((current) => ({ ...current, enabled: value }));
  const setHours = (value: string) => setForm((current) => ({ ...current, hours: value }));
  const [invalid, setInvalid] = useState(false);

  const save = useAction(async (certificateHours: number | null) => {
    const { data } = await api.PATCH('/api/v1/courses/{id}', {
      params: { path: { id: course.id } },
      body: {
        ...(enabled !== course.certificateEnabled ? { certificateEnabled: enabled } : {}),
        ...(certificateHours !== course.certificateHours ? { certificateHours } : {}),
        version: course.version,
      },
    });
    if (!data) throw new Error('PATCH /api/v1/courses/{id} respondeu sem corpo');
    return data;
  });
  const refusal = useFieldRefusal(save.error);

  const parsed = parseWhole(hours, 1, HOURS_MAX);
  const dirty = enabled !== course.certificateEnabled || parsed !== course.certificateHours;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setInvalid(parsed === undefined);
    // sem mudança, nada a gravar: o `PATCH` só com `version` é recusado
    if (parsed === undefined || !dirty) return;
    const result = await save.run(parsed);
    if (!result.ok) return;
    courseChanged(queryClient, result.data);
    toast.success(t('courses.certificate.saved'));
  };

  return (
    <AdminSection title={t('courses.certificate.title')}>
      {isVersionConflict(save.error) ? (
        <ConflictAlert
          className="mb-4"
          onReload={async () => {
            await refreshCourse(queryClient, course.id);
            save.reset();
          }}
        />
      ) : refusal.general(['certificateHours']) ? (
        <Alert tone="error" className="mb-4">
          {message(save.error)}
        </Alert>
      ) : null}
      <form className="flex max-w-3xl flex-col gap-4" noValidate onSubmit={onSubmit}>
        <div className="flex flex-col gap-1">
          <AdminSwitch checked={enabled} onChange={setEnabled}>
            {t('courses.certificate.enabled')}
          </AdminSwitch>
          <span className="text-sm text-ink-3">{t('courses.certificate.enabledHint')}</span>
        </div>
        <AdminField
          label={t('courses.certificate.hours')}
          hint={t('courses.certificate.hoursHint')}
          value={hours}
          onChange={setHours}
          maxLength={5}
          inputMode="numeric"
          autoComplete="off"
          error={invalid ? t('courses.certificate.hoursInvalid') : refusal.of('certificateHours')}
        />
        <div>
          <AdminButton variant="primary" type="submit" disabled={save.busy || !dirty}>
            {save.busy ? t('common.saving') : t('common.save')}
          </AdminButton>
        </div>
      </form>
    </AdminSection>
  );
}
