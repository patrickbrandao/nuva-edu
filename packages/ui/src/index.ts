/*
 * @nuva-edu/ui — ponto de entrada único.
 *
 * Os componentes copiados do minui-react continuam em JSX (ADR 0010) e ainda não
 * têm tipos próprios. `Loose` os expõe com todas as propriedades opcionais e sem
 * tipo de valor, para que os sites em TypeScript possam usá-los; cada componente
 * ganha tipos de verdade quando for convertido para TypeScript.
 */
import type { ReactNode } from 'react';
import * as rawAdminControls from './components/admin/AdminControls.jsx';
import * as rawAdminData from './components/admin/AdminData.jsx';
import * as rawAdminShell from './components/admin/AdminShell.jsx';
import * as rawCasesBoard from './components/admin/CasesBoard.jsx';
import * as rawClientOverview from './components/admin/ClientOverview.jsx';
import * as rawAvatar from './components/core/Avatar.jsx';
import * as rawBadge from './components/core/Badge.jsx';
import * as rawField from './components/core/Field.jsx';
import * as rawGlyph from './components/core/Glyph.jsx';
import * as rawPills from './components/core/Pills.jsx';
import * as rawResolved from './components/core/Resolved.jsx';
import * as rawSurface from './components/core/Surface.jsx';
import * as rawTxt from './components/core/Txt.jsx';
import * as rawExamplePage from './components/examples/ExamplePage.jsx';
import * as rawMarketingWaitlist from './components/examples/MarketingWaitlist.jsx';
import * as rawPricingPage from './components/examples/PricingPage.jsx';
import * as rawArrowButton from './components/snippets/ArrowButton.jsx';
import * as rawGlowTag from './components/snippets/GlowTag.jsx';
import * as rawSnippetCard from './components/snippets/SnippetCard.jsx';

// biome-ignore lint/suspicious/noExplicitAny: os componentes em JSX não declaram o tipo das propriedades
type LooseProps<P> = { [K in keyof P]?: any };
/** Componente em JSX visto do TypeScript: mesmas propriedades, todas opcionais. */
export type Loose<F> = F extends (props: infer P) => unknown
  ? (props: LooseProps<P>) => ReactNode
  : F;

// core/Avatar
export const Avatar = rawAvatar.Avatar as Loose<typeof rawAvatar.Avatar>;
export { initialsOf } from './components/core/Avatar.jsx';

// core/Badge
export const Badge = rawBadge.Badge as Loose<typeof rawBadge.Badge>;
export const Dot = rawBadge.Dot as Loose<typeof rawBadge.Dot>;

// core/Field
export const ReplyWords = rawField.ReplyWords as Loose<typeof rawField.ReplyWords>;
export const Field = rawField.Field as Loose<typeof rawField.Field>;
export { caretColor, normalizeWords } from './components/core/Field.jsx';

// core/Glyph
export const Glyph = rawGlyph.Glyph as Loose<typeof rawGlyph.Glyph>;

// core/Pills
export const LabelPill = rawPills.LabelPill as Loose<typeof rawPills.LabelPill>;
export const ActionButton = rawPills.ActionButton as Loose<typeof rawPills.ActionButton>;
export const DiffBlocks = rawPills.DiffBlocks as Loose<typeof rawPills.DiffBlocks>;
export { LABEL_HUES } from './components/core/Pills.jsx';

// core/Resolved
export const Resolved = rawResolved.Resolved as Loose<typeof rawResolved.Resolved>;
export { resolvedLabel } from './components/core/Resolved.jsx';

// core/Surface
export const Surface = rawSurface.Surface as Loose<typeof rawSurface.Surface>;

// core/Txt
export const Txt = rawTxt.Txt as Loose<typeof rawTxt.Txt>;

// admin/AdminShell
export const AdminScope = rawAdminShell.AdminScope as Loose<typeof rawAdminShell.AdminScope>;
export const AdminShell = rawAdminShell.AdminShell as Loose<typeof rawAdminShell.AdminShell>;
export const AdminNav = rawAdminShell.AdminNav as Loose<typeof rawAdminShell.AdminNav>;
export const AdminSidebar = rawAdminShell.AdminSidebar as Loose<typeof rawAdminShell.AdminSidebar>;
export const AdminTopbar = rawAdminShell.AdminTopbar as Loose<typeof rawAdminShell.AdminTopbar>;
export const AdminBreadcrumb = rawAdminShell.AdminBreadcrumb as Loose<
  typeof rawAdminShell.AdminBreadcrumb
>;
export const AdminContent = rawAdminShell.AdminContent as Loose<typeof rawAdminShell.AdminContent>;

// admin/AdminControls
export const AdminButton = rawAdminControls.AdminButton as Loose<
  typeof rawAdminControls.AdminButton
>;
export const AdminSearch = rawAdminControls.AdminSearch as Loose<
  typeof rawAdminControls.AdminSearch
>;
export const AdminMenu = rawAdminControls.AdminMenu as Loose<typeof rawAdminControls.AdminMenu>;
export const AdminField = rawAdminControls.AdminField as Loose<typeof rawAdminControls.AdminField>;
export const AdminCheckbox = rawAdminControls.AdminCheckbox as Loose<
  typeof rawAdminControls.AdminCheckbox
>;
export const AdminSwitch = rawAdminControls.AdminSwitch as Loose<
  typeof rawAdminControls.AdminSwitch
>;
export const AdminTabs = rawAdminControls.AdminTabs as Loose<typeof rawAdminControls.AdminTabs>;

// admin/AdminData
export const AdminTag = rawAdminData.AdminTag as Loose<typeof rawAdminData.AdminTag>;
export const AdminBadge = rawAdminData.AdminBadge as Loose<typeof rawAdminData.AdminBadge>;
export const AdminDot = rawAdminData.AdminDot as Loose<typeof rawAdminData.AdminDot>;
export const AdminStatus = rawAdminData.AdminStatus as Loose<typeof rawAdminData.AdminStatus>;
export const AdminAvatar = rawAdminData.AdminAvatar as Loose<typeof rawAdminData.AdminAvatar>;
export const AdminAvatars = rawAdminData.AdminAvatars as Loose<typeof rawAdminData.AdminAvatars>;
export const AdminCard = rawAdminData.AdminCard as Loose<typeof rawAdminData.AdminCard>;
export const AdminStats = rawAdminData.AdminStats as Loose<typeof rawAdminData.AdminStats>;
export const AdminStat = rawAdminData.AdminStat as Loose<typeof rawAdminData.AdminStat>;
export const AdminSection = rawAdminData.AdminSection as Loose<typeof rawAdminData.AdminSection>;
export const AdminPageHeader = rawAdminData.AdminPageHeader as Loose<
  typeof rawAdminData.AdminPageHeader
>;
export const AdminMeta = rawAdminData.AdminMeta as Loose<typeof rawAdminData.AdminMeta>;
export const AdminDetails = rawAdminData.AdminDetails as Loose<typeof rawAdminData.AdminDetails>;
export const AdminList = rawAdminData.AdminList as Loose<typeof rawAdminData.AdminList>;
export const AdminMessages = rawAdminData.AdminMessages as Loose<typeof rawAdminData.AdminMessages>;
export const AdminTimeline = rawAdminData.AdminTimeline as Loose<typeof rawAdminData.AdminTimeline>;
export const AdminTable = rawAdminData.AdminTable as Loose<typeof rawAdminData.AdminTable>;
export const AdminEmpty = rawAdminData.AdminEmpty as Loose<typeof rawAdminData.AdminEmpty>;

// admin/CasesBoard
export const CaseCard = rawCasesBoard.CaseCard as Loose<typeof rawCasesBoard.CaseCard>;
export const CaseColumn = rawCasesBoard.CaseColumn as Loose<typeof rawCasesBoard.CaseColumn>;
export const CasesBoard = rawCasesBoard.CasesBoard as Loose<typeof rawCasesBoard.CasesBoard>;
export {
  CASES,
  CASES_BRAND,
  CASES_COLUMNS,
  CASES_NAV,
  CASES_USER,
  timeAgo,
} from './components/admin/CasesBoard.jsx';

// admin/ClientOverview
export const CampaignCard = rawClientOverview.CampaignCard as Loose<
  typeof rawClientOverview.CampaignCard
>;
export const ClientOverview = rawClientOverview.ClientOverview as Loose<
  typeof rawClientOverview.ClientOverview
>;
export {
  CAMPAIGN_TONES,
  CLIENT,
  CLIENT_ACTIVITY,
  CLIENT_BRAND,
  CLIENT_CAMPAIGNS,
  CLIENT_COVERAGE,
  CLIENT_DETAILS,
  CLIENT_MESSAGES,
  CLIENT_NAV,
  CLIENT_STATS,
  CLIENT_USER,
} from './components/admin/ClientOverview.jsx';

// examples/ExamplePage
export const ExamplePage = rawExamplePage.ExamplePage as Loose<typeof rawExamplePage.ExamplePage>;
export const ExampleHead = rawExamplePage.ExampleHead as Loose<typeof rawExamplePage.ExampleHead>;
export const ExampleFeatures = rawExamplePage.ExampleFeatures as Loose<
  typeof rawExamplePage.ExampleFeatures
>;

// examples/PricingPage
export const PricingPage = rawPricingPage.PricingPage as Loose<typeof rawPricingPage.PricingPage>;
export { PRICING_PLANS, planPrice } from './components/examples/PricingPage.jsx';

// examples/MarketingWaitlist
export const MarketingWaitlist = rawMarketingWaitlist.MarketingWaitlist as Loose<
  typeof rawMarketingWaitlist.MarketingWaitlist
>;
export { WAITLIST_FEATURES, WAITLIST_PEOPLE } from './components/examples/MarketingWaitlist.jsx';

// snippets/ArrowButton
export const ArrowIcon = rawArrowButton.ArrowIcon as Loose<typeof rawArrowButton.ArrowIcon>;
export const ArrowButton = rawArrowButton.ArrowButton as Loose<typeof rawArrowButton.ArrowButton>;

// snippets/GlowTag
export const GlowTag = rawGlowTag.GlowTag as Loose<typeof rawGlowTag.GlowTag>;
export { TAG_HUES, tagHue } from './components/snippets/GlowTag.jsx';

// snippets/SnippetCard
export const SnippetCard = rawSnippetCard.SnippetCard as Loose<typeof rawSnippetCard.SnippetCard>;
export const SnippetGrid = rawSnippetCard.SnippetGrid as Loose<typeof rawSnippetCard.SnippetGrid>;

// limites do Markdown para o editor e a prévia (o mesmo módulo do núcleo)
export {
  countMarkdownCharacters,
  MARKDOWN_BODY_MAX_LENGTH,
} from '@nuva-edu/core/markdown';
// cor de destaque da escola: as contas de contraste dos tokens --minui-accent-* (TypeScript)
export type { AccentTheme } from './accent/accent';
export {
  accentHover,
  accentOn,
  accentText,
  contrastRatio,
  isHexColor,
  relativeLuminance,
} from './accent/accent';
// catálogo: Markdown restrito, lista reordenável, acordeão, abas, progresso e cartão (TypeScript)
export type { AccordionItem, AccordionProps } from './components/catalog/Accordion';
export { Accordion } from './components/catalog/Accordion';
export type {
  LegacyMarkdownElement,
  MarkdownElement,
  MarkdownPreviewProps,
  MarkdownProps,
} from './components/catalog/Markdown';
export {
  MARKDOWN_ELEMENTS,
  MARKDOWN_PROTOCOLS,
  Markdown,
  MarkdownPreview,
  safeMarkdownUrl,
} from './components/catalog/Markdown';
export type {
  ProductCardLayout,
  ProductCardListProps,
  ProductCardProgress,
  ProductCardProps,
} from './components/catalog/ProductCard';
export { ProductCard, ProductCardList } from './components/catalog/ProductCard';
export type { ProgressBarProps } from './components/catalog/ProgressBar';
export { clampPercent, ProgressBar } from './components/catalog/ProgressBar';
export type { SortableListLabels, SortableListProps } from './components/catalog/SortableList';
export { SortableList } from './components/catalog/SortableList';
export type { TabItem, TabsProps } from './components/catalog/Tabs';
export { Tabs } from './components/catalog/Tabs';
// comunidade: editor, fórum, reações, menções, moderação, chamados, calendário, novidades e notificações (Fase 4; specs 017, 018, 023, 024, 025 e 026)
export type {
  Announcement,
  AnnouncementCardLabels,
  AnnouncementCardProps,
  AnnouncementLink,
  AnnouncementListLabels,
  AnnouncementListProps,
} from './components/community/Announcements';
export { AnnouncementCard, AnnouncementList } from './components/community/Announcements';
export type {
  CalendarEvent,
  EventBannerLabels,
  EventBannerProps,
  EventCardLabels,
  EventCardProps,
  EventKind,
  EventStatusLabels,
  EventTimeProps,
  MonthCalendarLabels,
  MonthCalendarProps,
} from './components/community/Calendar';
export {
  EventBanner,
  EventCard,
  EventStatusBadge,
  EventTime,
  MonthCalendar,
} from './components/community/Calendar';
export type { MarkdownEditorLabels, MarkdownEditorProps } from './components/community/Editor';
export { MarkdownEditor } from './components/community/Editor';
export type {
  ForumAuthor,
  ForumPost,
  ForumTopic,
  ForumTopicStatus,
  PostCardLabels,
  PostCardProps,
  PostComposerProps,
  TopicBadgesLabels,
  TopicCardLabels,
  TopicCardProps,
  TopicHeaderProps,
  TopicListLabels,
  TopicListProps,
} from './components/community/Forum';
export {
  PostCard,
  PostComposer,
  TopicBadges,
  TopicCard,
  TopicHeader,
  TopicList,
} from './components/community/Forum';
export type {
  MentionCandidate,
  MentionKeyAction,
  MentionListLabels,
  MentionListProps,
  MentionQuery,
} from './components/community/Mentions';
export {
  insertMention,
  MentionList,
  mentionKey,
  mentionOptionId,
  mentionQueryBeforeCaret,
} from './components/community/Mentions';
export type {
  ModerationHistoryItem,
  ModerationHistoryLabels,
  ModerationHistoryProps,
  ReportDialogLabels,
  ReportDialogProps,
  ReportedContentLabels,
  ReportedContentProps,
  ReportedTarget,
  ReportInput,
  ReportReason,
} from './components/community/Moderation';
export {
  ModerationHistory,
  REPORT_REASONS,
  ReportDialog,
  ReportedContent,
} from './components/community/Moderation';
export type {
  NotificationBellLabels,
  NotificationBellProps,
  NotificationChannel,
  NotificationEntry,
  NotificationGroupPreference,
  NotificationListLabels,
  NotificationListProps,
  NotificationPreferencesLabels,
  NotificationPreferencesProps,
} from './components/community/Notifications';
export {
  NotificationBell,
  NotificationList,
  NotificationPreferences,
} from './components/community/Notifications';
export type {
  Reaction,
  ReactionEmoji,
  ReactionKey,
  ReactionLabels,
  ReactionsProps,
} from './components/community/Reactions';
export { REACTION_EMOJIS, REACTION_KEYS, Reactions } from './components/community/Reactions';
export type {
  ReportLinkDialogLabels,
  ReportLinkDialogProps,
  TicketComposerProps,
  TicketConversationLabels,
  TicketConversationProps,
  TicketListLabels,
  TicketListProps,
  TicketMessage,
  TicketStatus,
  TicketStatusBadgeProps,
  TicketSummary,
} from './components/community/Support';
export {
  ReportLinkDialog,
  TicketComposer,
  TicketConversation,
  TicketList,
  TicketStatusBadge,
} from './components/community/Support';
export type {
  CalendarDay,
  EventJoinState,
  EventStatus,
  ZonedParts,
} from './components/community/time';
export {
  addMonths,
  buildMonthGrid,
  civilWeekday,
  EVENT_JOIN_WINDOW_MS,
  eventJoinState,
  eventStatus,
  formatCivilDate,
  formatMonthLabel,
  todayKey,
  toInstant,
  weekdayLabels,
  zonedDateKey,
  zonedMonthKey,
  zonedParts,
} from './components/community/time';
export { ICON_PATHS } from './components/core/iconPaths.js';
// avisos e diálogos: Dialog, ConfirmDialog, Toast com provedor, Alert (TypeScript)
export type { AlertProps, AlertTone } from './components/feedback/Alert';
export { Alert } from './components/feedback/Alert';
export type { ConfirmDialogProps, DialogProps } from './components/feedback/Dialog';
export { ConfirmDialog, Dialog } from './components/feedback/Dialog';
export type {
  ToastAction,
  ToastApi,
  ToastOptions,
  ToastProps,
  ToastProviderProps,
  ToastTone,
} from './components/feedback/Toast';
export { Toast, ToastProvider, useToast } from './components/feedback/Toast';
// fluxo: título de página, link de texto, estados de carregando e erro (TypeScript)
export type {
  ErrorStateProps,
  LoadingStateProps,
  PageTitleProps,
  TextLinkProps,
} from './components/flow/flow';
export { ErrorState, LoadingState, PageTitle, TextLink } from './components/flow/flow';
// formulário: campo de senha, texto de várias linhas e seletor de imagem (TypeScript)
export type { AdminTextAreaProps, TextAreaCounterInfo } from './components/form/AdminTextArea';
export { AdminTextArea } from './components/form/AdminTextArea';
export type {
  ImagePickerProps,
  ImagePickerShape,
  ImageRejection,
} from './components/form/ImagePicker';
export {
  checkImageFile,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  ImagePicker,
} from './components/form/ImagePicker';
export type { PasswordCounterInfo, PasswordInputProps } from './components/form/PasswordInput';
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordInput,
} from './components/form/PasswordInput';
// aprendizado: player de vídeo por provedor e mapa de atividade (TypeScript)
export type {
  ActivityDay,
  ActivityHeatmapLabels,
  ActivityHeatmapProps,
  HeatmapCell,
} from './components/learning/ActivityHeatmap';
export {
  ActivityHeatmap,
  activityLevel,
  buildActivityGrid,
  HEATMAP_LEVELS,
  HEATMAP_WEEKS,
} from './components/learning/ActivityHeatmap';
export type {
  VideoPlayerError,
  VideoPlayerHandle,
  VideoPlayerLabels,
  VideoPlayerProps,
} from './components/learning/VideoPlayer';
export { VideoPlayer } from './components/learning/VideoPlayer';
export type { VideoProvider, VideoSource } from './components/learning/video/source';
export { resolveVideoSource } from './components/learning/video/source';
export {
  RESUME_TAIL_SECONDS,
  resumePosition,
  TIME_REPORT_INTERVAL_MS,
} from './components/learning/video/time';
// link do roteador (TypeScript)
export type {
  LinkComponent,
  LinkProps,
  LinkProviderProps,
  LinkTarget,
} from './components/link/link';
export { isInternalHref, LinkProvider, useLinkComponent } from './components/link/link';
// vendas: cesta, preço/desconto, dados do comprador, estados e planos (TypeScript; specs 011 e 012)
export type {
  BuyerData,
  BuyerFieldsLabels,
  BuyerFieldsProps,
  BuyerFormLabels,
  BuyerFormProps,
  TaxIdType,
} from './components/sales/BuyerForm';
export { BuyerFields, BuyerForm } from './components/sales/BuyerForm';
export type { CartItem, CartLabels, CartProps, CartSummaryProps } from './components/sales/Cart';
export { Cart, CartSummary } from './components/sales/Cart';
export type { MoneyOptions } from './components/sales/money';
export { formatMoney } from './components/sales/money';
export type {
  OrderStatus,
  OrderStatusBadgeProps,
  PaymentResultLabels,
  PaymentResultProps,
  SubscriptionStatus,
  SubscriptionStatusBadgeProps,
} from './components/sales/OrderStatus';
export {
  OrderStatusBadge,
  PaymentResult,
  SubscriptionStatusBadge,
} from './components/sales/OrderStatus';
export type {
  BillingInterval,
  BillingToggleLabels,
  BillingToggleProps,
  PlanCardData,
  PlanCardProps,
  PlanGridLabels,
  PlanGridProps,
} from './components/sales/Plans';
export { BillingToggle, PlanCard, PlanGrid } from './components/sales/Plans';
export type { OrderTotalsProps, OrderTotalsRow, PriceTagProps } from './components/sales/PriceTag';
export { OrderTotals, PriceTag } from './components/sales/PriceTag';
// casca do site do aluno e rodapé das cascas (TypeScript)
export type {
  ClassroomShellLabels,
  ClassroomShellProps,
  ShellBrand,
  ShellCrumb,
  ShellFooterLink,
  ShellFooterProps,
  ShellNavGroup,
  ShellNavItem,
} from './components/shell/ClassroomShell';
export { ClassroomShell, ShellFooter } from './components/shell/ClassroomShell';
export { useMediaQuery, useNarrowViewport } from './components/shell/drawer';
// utilitários
export { cx, firstName, hueOf } from './lib/util.js';
// tema (TypeScript)
export type { ThemeBootPlugin } from './theme/boot';
export { themeBootPlugin } from './theme/boot';
export type {
  ActiveTheme,
  ThemeMode,
  ThemeOptionText,
  ThemeSwitchLabels,
  ThemeSwitchProps,
} from './theme/theme';
export {
  applyTheme,
  readSavedTheme,
  THEME_BAR_COLORS,
  THEME_BOOT_SCRIPT,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  ThemeSwitch,
  useTheme,
} from './theme/theme';
