import { type AdminSchemas, isApiError, uploadAdminImage } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminField,
  AdminSection,
  AdminTextArea,
  Alert,
  ImagePicker,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { useCourseError } from '../../pages/courses/errors';
import {
  opsKeys,
  type SchoolBranding,
  type SchoolBrandingInput,
  saveBranding,
  useBranding,
} from './queries';

/*
 * Identidade da escola nos e-mails (spec 024, "E-mail"; spec 029, "Finalidades e variantes";
 * spec 031, "Configurações da escola"; `GET|PUT /api/v1/settings/branding`, `settings.manage`).
 * O admin edita nome, cor de destaque, rodapé e logotipo; os modelos completos continuam no
 * código do worker. O logotipo é enviado antes, por `POST /api/v1/images` com a finalidade
 * `school_logo`, e o identificador devolvido vai no `saveBranding`; o arquivo original não é
 * cortado (as variantes 64, 256 e 512 têm o maior lado no nome, spec 029).
 */

const SCHOOL_NAME_MAX = 120;
const FOOTER_MAX = 500;
const IMAGE_ID =
  /\/api\/v1\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/** Identificador da imagem a partir do `logoUrl` de entrega (`/api/v1/images/<id>/256.webp`). */
function imageIdOf(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  return IMAGE_ID.exec(logoUrl)?.[1]?.toLowerCase() ?? null;
}

/** Prévia do logotipo: a variante de 256, como no `/meta`, ou a de 512. */
function previewUrlOf(image: AdminSchemas['Image']): string | null {
  for (const width of [256, 512] as const) {
    const variant = image.variants.find((candidate) => candidate.width === width);
    if (variant) return variant.url;
  }
  return image.variants[0]?.url ?? null;
}

/** Seção "E-mail" de `/configuracoes`. */
export function BrandingSection() {
  const { t } = useTranslation();
  const branding = useBranding();

  return (
    <AdminSection title={t('settings.branding.title')}>
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">{t('settings.branding.text')}</p>
      {branding.isPending ? (
        <LoadingState label={t('settings.branding.loading')} />
      ) : branding.isError ? (
        <QueryErrorState
          error={branding.error}
          title={t('settings.branding.errorTitle')}
          onRetry={() => void branding.refetch()}
          retrying={branding.isFetching}
        />
      ) : (
        <BrandingForm branding={branding.data} />
      )}
    </AdminSection>
  );
}

function BrandingForm({ branding }: { branding: SchoolBranding }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useCourseError();
  const [schoolName, setSchoolName] = useState(branding.schoolName);
  const [accentColor, setAccentColor] = useState(branding.accentColor ?? '');
  const [footer, setFooter] = useState(branding.footer ?? '');
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl);
  // O identificador acompanha o que está na tela: o envio troca a imagem e o "remover" o zera;
  // a gravação leva o valor atual no `saveBranding`.
  const [logoImageId, setLogoImageId] = useState<string | null>(() => imageIdOf(branding.logoUrl));
  // Trocar a chave remonta o seletor: a prévia local (`blob:`) sai e fica a variante do servidor.
  const [pickerKey, setPickerKey] = useState(0);

  const save = useAction((body: SchoolBrandingInput) => saveBranding(api, body));
  const upload = useAction(async (file: File) => {
    const { data } = await uploadAdminImage(api, file, 'school_logo');
    if (!data) throw new Error('POST /api/v1/images respondeu sem corpo');
    return data;
  });

  const fields = new Set(
    isApiError(save.error)
      ? save.error.fieldErrors.map((field) => field.path.replace(/^body\./, ''))
      : [],
  );
  const purposeMismatch =
    (isApiError(save.error) && save.error.code === 'image_purpose_mismatch') ||
    (isApiError(upload.error) && upload.error.code === 'image_purpose_mismatch');
  const generalError = Boolean(save.error) && !purposeMismatch && fields.size === 0;
  const logoError = purposeMismatch
    ? t('settings.branding.logoErrors.purposeMismatch')
    : upload.error
      ? message(upload.error)
      : undefined;

  const changeLogo = async (file: File) => {
    const result = await upload.run(file);
    if (!result.ok) return;
    // a recusa anterior da gravação era da imagem que saiu da tela
    save.reset();
    setLogoImageId(result.data.id);
    setLogoUrl(previewUrlOf(result.data));
    setPickerKey((key) => key + 1);
    toast.success(t('settings.branding.logoUploaded'));
  };

  const removeLogo = () => {
    save.reset();
    upload.reset();
    setLogoImageId(null);
    setLogoUrl(null);
    setPickerKey((key) => key + 1);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const color = accentColor.trim();
    const result = await save.run({
      schoolName: schoolName.trim(),
      logoImageId,
      accentColor: color === '' ? null : color,
      footer: footer.trim() === '' ? null : footer,
    });
    if (!result.ok) return;
    queryClient.setQueryData(opsKeys.branding(), result.data);
    // A casca usa nome e cor do `/meta`: a próxima leitura já mostra o novo.
    void queryClient.invalidateQueries({ queryKey: ['meta'] });
    setLogoImageId(imageIdOf(result.data.logoUrl));
    setLogoUrl(result.data.logoUrl);
    setPickerKey((key) => key + 1);
    toast.success(t('settings.branding.saved'));
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex max-w-3xl flex-col gap-4">
      {generalError ? <Alert tone="error">{t('forms.invalid')}</Alert> : null}
      <AdminField
        label={t('settings.branding.schoolName')}
        hint={t('settings.branding.schoolNameHint')}
        error={fields.has('schoolName') ? t('forms.invalid') : undefined}
        value={schoolName}
        maxLength={SCHOOL_NAME_MAX}
        onChange={setSchoolName}
      />
      <AdminField
        label={t('settings.branding.accentColor')}
        hint={t('settings.branding.accentColorHint')}
        error={fields.has('accentColor') ? t('forms.invalid') : undefined}
        value={accentColor}
        placeholder="#1F6FEB"
        maxLength={7}
        onChange={setAccentColor}
      />
      <ImagePicker
        key={pickerKey}
        shape="square"
        label={t('settings.branding.logo')}
        chooseLabel={
          upload.busy ? t('settings.branding.logoSending') : t('settings.branding.logoChoose')
        }
        changeLabel={
          upload.busy ? t('settings.branding.logoSending') : t('settings.branding.logoChange')
        }
        removeLabel={t('settings.branding.logoRemove')}
        limitHint={t('settings.branding.logoHint')}
        errors={{
          tooLarge: t('courses.errors.payload_too_large'),
          wrongType: t('courses.errors.image_type_unsupported'),
        }}
        previewAlt={t('settings.branding.logoAlt', {
          name: schoolName.trim() || branding.schoolName,
        })}
        currentUrl={logoUrl}
        placeholder={t('settings.branding.noLogo')}
        busy={upload.busy}
        error={logoError}
        onChange={(file) => {
          if (file) void changeLogo(file);
        }}
        onRemove={removeLogo}
      />
      <AdminTextArea
        label={t('settings.branding.footer')}
        hint={t('settings.branding.footerHint')}
        error={fields.has('footer') ? t('forms.invalid') : undefined}
        value={footer}
        maxLength={FOOTER_MAX}
        rows={4}
        counter={(info) =>
          t('settings.branding.footerCounter', { length: info.length, max: info.max })
        }
        onChange={setFooter}
      />
      <div>
        <AdminButton
          type="submit"
          variant="primary"
          disabled={save.busy}
          aria-busy={save.busy || undefined}
        >
          {save.busy ? t('common.saving') : t('common.save')}
        </AdminButton>
      </div>
    </form>
  );
}
