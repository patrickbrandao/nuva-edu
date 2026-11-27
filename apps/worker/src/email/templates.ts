import {
  type AnyEmailDataByType,
  type AnyEmailType,
  type EmailType,
  isEmailType,
} from '@nuva-edu/core';
import {
  type NotificationTemplateType,
  notificationCopy,
  notificationSubjects,
} from './locales/notification-pt-BR.ts';
import { ptBR } from './locales/pt-BR.ts';

// Montagem dos e-mails (spec 024, RF-06): o modelo do tipo, no idioma da instalação, vira
// assunto, texto e HTML. Os textos ficam nos arquivos de `locales/`; aqui só o layout.

/**
 * Tipos que o núcleo ainda lista como "sem modelo no worker" (`PendingTemplateEmailType`) e que
 * já têm modelo aqui. Quando o núcleo os passar para `EmailType` (tarefa 416), a lista fica
 * redundante e pode ser esvaziada, sem outra mudança.
 */
export const EXTRA_TEMPLATE_EMAIL_TYPES = [
  'access.granted',
  'certificate.issued',
] as const satisfies readonly AnyEmailType[];

/** Tipos com modelo no worker: os do núcleo e os de `EXTRA_TEMPLATE_EMAIL_TYPES`. */
export type TemplateEmailType = EmailType | (typeof EXTRA_TEMPLATE_EMAIL_TYPES)[number];

const EXTRA_TEMPLATE_SET: ReadonlySet<string> = new Set(EXTRA_TEMPLATE_EMAIL_TYPES);

/** `true` para o tipo que o worker sabe montar. */
export function isTemplateEmailType(type: string): type is TemplateEmailType {
  return isEmailType(type) || EXTRA_TEMPLATE_SET.has(type);
}

export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailContent {
  subject: string;
  /** Um parágrafo por item; `\n` dentro do item quebra a linha. */
  paragraphs: string[];
  actions: EmailAction[];
}

export interface EmailLinks {
  /**
   * Endereço no site do aluno. Com `withToken`, leva `?token=` com o token do e-mail: só os
   * tipos com token pedem, e pedir sem token é erro de programação.
   */
  classroom(path: string, withToken?: boolean): string;
  /** Raiz do site admin. */
  admin: string;
}

export interface TemplateContext<T extends TemplateEmailType> {
  school: string;
  data: AnyEmailDataByType[T];
  links: EmailLinks;
  /** Data e hora no fuso da escola, por extenso curto (`24/11/2026, 14:30`). */
  formatDateTime(iso: string): string;
}

export type EmailTemplates = {
  [T in TemplateEmailType]: (context: TemplateContext<T>) => EmailContent;
} & {
  greeting(name: string): string;
  linkHint: string;
  footer(school: string): string;
};

const LOCALES: Readonly<Record<string, EmailTemplates>> = { 'pt-BR': ptBR };
const DEFAULT_LOCALE = 'pt-BR';
const DEFAULT_ACCENT = '#2563eb';

export function templatesFor(locale: string): EmailTemplates {
  return LOCALES[locale] ?? (LOCALES[DEFAULT_LOCALE] as EmailTemplates);
}

export interface RenderInput<T extends TemplateEmailType> {
  type: T;
  data: AnyEmailDataByType[T];
  locale: string;
  recipientName: string;
  school: {
    name: string;
    timezone: string;
    accentColor: string | null;
    logoUrl: string | null;
    emailFooter?: string | null;
  };
  classroomUrl: string;
  adminUrl: string;
  /** Token em claro do link, só nos tipos que o têm. Vai só no corpo devolvido. */
  token: string | null;
  unsubscribeUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail<T extends TemplateEmailType>(input: RenderInput<T>): RenderedEmail {
  const templates = templatesFor(input.locale);
  const dateFormat = new Intl.DateTimeFormat(templatesLocale(input.locale), {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: input.school.timezone,
  });
  const links: EmailLinks = {
    classroom(path, withToken = false) {
      const url = new URL(path, input.classroomUrl);
      if (withToken) {
        if (input.token === null) {
          throw new Error(`O e-mail ${input.type} pediu link com token sem token emitido.`);
        }
        url.searchParams.set('token', input.token);
      }
      return url.toString();
    },
    admin: new URL('/', input.adminUrl).toString(),
  };
  const template = templates[input.type] as (context: TemplateContext<T>) => EmailContent;
  const content = template({
    school: input.school.name,
    data: input.data,
    links,
    formatDateTime: (iso) => dateFormat.format(new Date(iso)),
  });
  return renderContent(input, content, templates);
}

export function isNotificationTemplateType(type: string): type is NotificationTemplateType {
  return Object.hasOwn(notificationSubjects, type);
}

type NotificationRenderInput = Omit<RenderInput<TemplateEmailType>, 'type' | 'data' | 'token'> & {
  type: NotificationTemplateType;
  data: Record<string, unknown>;
  forStaff?: boolean;
};

export function renderNotificationEmail(input: NotificationRenderInput): RenderedEmail {
  const subject = notificationSubjects[input.type];
  const summary = [
    'title',
    'topicTitle',
    'courseTitle',
    'planTitle',
    'eventTitle',
    'subject',
    'summary',
  ]
    .map((field) => input.data[field])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const targetHost = input.forStaff ? input.adminUrl : input.classroomUrl;
  const content: EmailContent = {
    subject: notificationCopy.inSchool(subject, input.school.name),
    paragraphs: summary ? [subject, summary] : [subject],
    actions: [
      { label: notificationCopy.open, url: new URL('/notificacoes', targetHost).toString() },
    ],
  };
  return renderContent(input, content, templatesFor(input.locale));
}

function renderContent(
  input: Pick<RenderInput<TemplateEmailType>, 'recipientName' | 'school' | 'unsubscribeUrl'>,
  content: EmailContent,
  templates: EmailTemplates,
): RenderedEmail {
  const greeting = templates.greeting(input.recipientName);
  const footer = input.school.emailFooter ?? templates.footer(input.school.name);
  const actions =
    input.unsubscribeUrl === undefined
      ? content.actions
      : [...content.actions, { label: notificationCopy.unsubscribe, url: input.unsubscribeUrl }];
  const message = { ...content, actions };
  return {
    subject: content.subject,
    text: renderText(greeting, message, footer),
    html: renderHtml(greeting, message, footer, templates.linkHint, input.school),
  };
}

function templatesLocale(locale: string): string {
  return Object.hasOwn(LOCALES, locale) ? locale : DEFAULT_LOCALE;
}

function renderText(greeting: string, content: EmailContent, footer: string): string {
  const blocks = [greeting, ...content.paragraphs];
  for (const action of content.actions) {
    blocks.push(`${action.label}:\n${action.url}`);
  }
  blocks.push('--', footer);
  return `${blocks.join('\n\n')}\n`;
}

function renderHtml(
  greeting: string,
  content: EmailContent,
  footer: string,
  linkHint: string,
  school: RenderInput<TemplateEmailType>['school'],
): string {
  const accent = school.accentColor ?? DEFAULT_ACCENT;
  const header =
    school.logoUrl === null
      ? `<p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:${accent}">${escapeHtml(school.name)}</p>`
      : `<p style="margin:0 0 24px"><img src="${escapeHtml(school.logoUrl)}" alt="${escapeHtml(school.name)}" height="48" style="height:48px;border:0"></p>`;
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px">${escapeHtml(text).replaceAll('\n', '<br>')}</p>`;
  const buttons = content.actions
    .map(
      (action) =>
        `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;background:${accent};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">${escapeHtml(action.label)}</a></p>`,
    )
    .join('');
  const fallback =
    content.actions.length === 0
      ? ''
      : `<p style="margin:0 0 16px;font-size:13px;color:#555555">${escapeHtml(linkHint)}<br>${content.actions
          .map((action) => `<a href="${escapeHtml(action.url)}">${escapeHtml(action.url)}</a>`)
          .join('<br>')}</p>`;
  return [
    '<!doctype html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    `<title>${escapeHtml(content.subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222">',
    '<div style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:8px">',
    header,
    paragraph(greeting),
    ...content.paragraphs.map(paragraph),
    buttons,
    fallback,
    `<hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0"><p style="margin:0;font-size:12px;color:#777777">${escapeHtml(footer).replaceAll('\n', '<br>')}</p>`,
    '</div></body></html>',
  ].join('');
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
