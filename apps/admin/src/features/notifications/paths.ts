/*
 * Endereços da central da equipe (spec 024). A central e as preferências não têm item de menu
 * (spec 006 não as lista no mapa do admin): chegam pelo sino da barra superior. Os dois ficam
 * sob `/notificacoes` para a trilha e o título da aba seguirem o mesmo item.
 */

/** Central completa, aberta pelo "Ver todas" do sino. */
export const NOTIFICATIONS_PATH = '/notificacoes';

/** Preferências por grupo e canal da equipe. */
export const NOTIFICATION_PREFS_PATH = '/notificacoes/preferencias';

/** Itens por página da central (o contrato aceita de 1 a 50). */
export const NOTIFICATIONS_PAGE_SIZE = 20;
