import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminField,
  AdminSection,
  AdminTextArea,
  Alert,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import {
  opsKeys,
  type SchoolBranding,
  type SchoolBrandingInput,
  saveBranding,
  useBranding,
} from './queries';

/*
 * Identidade da escola nos e-mails (spec 024, "E-mail"; spec 031, "Configurações da escola";
 * `GET|PUT /api/v1/settings/branding`, `settings.manage`). O admin edita nome, cor de destaque e
 * rodapé; os modelos completos continuam no código do worker. O logotipo aparece como está
 * hoje: o envio de imagem com a finalidade da escola ainda não existe no contrato do admin, e
 * trocá-lo por outra finalidade cortaria a imagem em 16:9.
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
  const [schoolName, setSchoolName] = useState(branding.schoolName);
  const [accentColor, setAccentColor] = useState(branding.accentColor ?? '');
  const [footer, setFooter] = useState(branding.footer ?? '');
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl);
  // O identificador vem do caminho de entrega; sai daqui uma vez só para o formulário não
  // apagar o logotipo se a leitura mudar de formato.
  const [logoImageId] = useState(() => imageIdOf(branding.logoUrl));

  const save = useAction((body: SchoolBrandingInput) => saveBranding(api, body));

  const fields = new Set(
    isApiError(save.error)
      ? save.error.fieldErrors.map((field) => field.path.replace(/^body\./, ''))
      : [],
  );
  const generalError = Boolean(save.error) && fields.size === 0;

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
    setLogoUrl(result.data.logoUrl);
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
      <div className="flex flex-col gap-1">
        <span className="minui-adm-field__label">{t('settings.branding.logo')}</span>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={t('settings.branding.logoAlt', { name: schoolName })}
            className="h-12 w-auto max-w-48 object-contain"
          />
        ) : (
          <span className="text-sm text-ink-3">{t('settings.branding.noLogo')}</span>
        )}
        <span className="text-sm text-ink-3">{t('settings.branding.logoReadOnly')}</span>
      </div>
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
