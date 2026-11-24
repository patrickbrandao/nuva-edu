import { AdminButton } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useRuntimeConfig } from '../config/useRuntimeConfig';
import { isStaff, useSessionRole } from '../session/role';

/**
 * Item "Administração" (spec 006, "Configuração de execução"): leva a equipe ao site de
 * administração, no endereço do `/config.json`. Não aparece para visitante, para `student` nem
 * quando o arquivo falta ou é inválido. É o item do menu do usuário; enquanto esse menu não
 * existe (a sessão chega na Fase 1), fica na barra superior.
 */
export function AdminLink() {
  const { t } = useTranslation();
  const config = useRuntimeConfig();
  const role = useSessionRole();

  if (!config || !isStaff(role)) return null;
  return (
    <AdminButton href={config.adminUrl} variant="ghost">
      {t('shell.administration')}
    </AdminButton>
  );
}
