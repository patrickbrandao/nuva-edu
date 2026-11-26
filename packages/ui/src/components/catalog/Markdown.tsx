import {
  isAllowedMarkdownImageUrl,
  isAllowedMarkdownLinkUrl,
  MARKDOWN_ALLOWED_ELEMENTS,
  MARKDOWN_IMAGE_ATTRIBUTES,
  type MARKDOWN_LEGACY_ELEMENTS,
  MARKDOWN_LINK_ATTRIBUTES,
  MARKDOWN_LINK_PROTOCOLS,
  markdownSanitizeSchema,
  normalizeMarkdownUrl,
  renderLegacyMarkdown,
  renderMarkdownToHtml,
} from '@nuva-edu/core/markdown';
import type { Root } from 'hast';
import { type Components, toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { ComponentProps, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import { unified } from 'unified';
import '../../styles/tokens.css';
import './catalog.css';

/*
 * Markdown saneado (spec 006; spec 017, RF-05; ADR 0027).
 *
 * - O HTML que o servidor gravou (`body_html`) é lido por `rehype-parse`, higienizado de novo
 *   pela política do `@nuva-edu/core/markdown` (`rehype-sanitize`) e convertido em elementos
 *   React por `hast-util-to-jsx-runtime`. A marcação nunca é injetada direto no nó: tudo passa
 *   pela árvore higienizada e pelos componentes explícitos (ADR 0027).
 * - Link e imagem têm componente próprio, que repete a conferência de URL e fixa os atributos
 *   da ADR 0027 mesmo quando o HTML recebido foi adulterado. O texto `newTabLabel` e o
 *   `missingAltLabel` são os textos acessíveis comuns aos dois sites.
 * - `children` continua sendo o Markdown gravado antes da ADR 0027: é desenhado pelo mesmo
 *   módulo do núcleo em modo legado (sem imagem externa e com HTML escrito pela pessoa
 *   aparecendo como texto). `html` tem precedência quando presente.
 * - `MarkdownPreview` usa o mesmo pipeline da gravação: a prévia do editor é, por construção,
 *   o conteúdo que a API persiste.
 */

/** Elementos que o HTML saneado pode conter (a lista vem do módulo do núcleo). */
export const MARKDOWN_ELEMENTS = MARKDOWN_ALLOWED_ELEMENTS;

/** Protocolos aceitos nos links, no formato antigo (com `:`), mantido para os consumidores. */
export const MARKDOWN_PROTOCOLS = MARKDOWN_LINK_PROTOCOLS.map((protocol) => `${protocol}:`);

/** Devolve o endereço normalizado se o protocolo é aceito; senão, texto vazio. */
export function safeMarkdownUrl(url: string): string {
  return normalizeMarkdownUrl(url, 'link') ?? '';
}

export interface MarkdownProps {
  /** HTML saneado devolvido pela API (`body_html`); tem precedência sobre `children`. */
  html?: string | null | undefined;
  /**
   * Markdown anterior à ADR 0027 (descrição, nota e outros textos já gravados), desenhado em
   * modo legado: sem imagem externa e com o HTML escrito pela pessoa aparecendo como texto.
   */
  children?: string | null | undefined;
  /** Texto lido depois de cada link, que abre em outra aba (ex.: "abre em nova aba"). */
  newTabLabel?: string | undefined;
  /**
   * Texto acessível de imagem cujo HTML não trouxe `alt`. Nunca se usa o endereço como
   * alternativa; sem este texto, a imagem fica decorativa (`alt=""`).
   */
  missingAltLabel?: string | undefined;
  className?: string | undefined;
}

export interface MarkdownPreviewProps {
  /** Markdown em edição, convertido pelo mesmo pipeline que a API usa ao gravar. */
  markdown: string | null | undefined;
  newTabLabel?: string | undefined;
  missingAltLabel?: string | undefined;
  className?: string | undefined;
}

/** Atributos fixos do link, repetidos na exibição mesmo sobre HTML adulterado. */
const LINK_ATTRIBUTES = MARKDOWN_LINK_ATTRIBUTES;
/** Atributos fixos da imagem, repetidos na exibição mesmo sobre HTML adulterado. */
const IMAGE_ATTRIBUTES = MARKDOWN_IMAGE_ATTRIBUTES;

type AnchorProps = ComponentProps<'a'>;
type ImageProps = ComponentProps<'img'>;

function MarkdownLink({
  href,
  children,
  newTabLabel,
  target: _target,
  rel: _rel,
  ...rest
}: AnchorProps & { newTabLabel?: string | undefined }) {
  if (!href || !isAllowedMarkdownLinkUrl(href)) return <span>{children}</span>;
  return (
    <a
      {...rest}
      href={normalizeMarkdownUrl(href, 'link') ?? href}
      target={LINK_ATTRIBUTES.target}
      rel={LINK_ATTRIBUTES.rel}
    >
      {children}
      {newTabLabel ? <span className="minui-sr-only"> {newTabLabel}</span> : null}
    </a>
  );
}

function MarkdownImage({
  src,
  alt,
  missingAltLabel,
  loading: _loading,
  referrerPolicy: _referrerPolicy,
  ...rest
}: ImageProps & { missingAltLabel?: string | undefined }) {
  if (typeof src !== 'string' || !isAllowedMarkdownImageUrl(src)) {
    // A imagem foi recusada: o texto alternativo continua visível, como no Markdown.
    return alt ? <span>{alt}</span> : null;
  }
  return (
    <img
      {...rest}
      src={normalizeMarkdownUrl(src, 'image') ?? src}
      alt={alt ?? missingAltLabel ?? ''}
      loading={IMAGE_ATTRIBUTES.loading}
      referrerPolicy={IMAGE_ATTRIBUTES.referrerpolicy}
    />
  );
}

/** Higieniza o HTML com a política comum e devolve a árvore pronta para o React. */
function sanitizeHtml(html: string, legacy: boolean): Root {
  const processor = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeSanitize, markdownSanitizeSchema({ allowImages: !legacy }));
  return processor.runSync(processor.parse(html)) as Root;
}

function toReact(tree: Root, props: Pick<MarkdownProps, 'newTabLabel' | 'missingAltLabel'>) {
  const components: Partial<Components> = {
    a: (componentProps: AnchorProps) => (
      <MarkdownLink {...componentProps} newTabLabel={props.newTabLabel} />
    ),
    img: (componentProps: ImageProps) => (
      <MarkdownImage {...componentProps} missingAltLabel={props.missingAltLabel} />
    ),
  };
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components,
    ignoreInvalidStyle: true,
  });
}

/**
 * Aceita o HTML saneado da API e o escreve como elementos React; `children` cobre o Markdown
 * anterior à ADR 0027. A lista de elementos e a política de URLs vêm do `@nuva-edu/core`.
 */
export function Markdown({
  html,
  children,
  newTabLabel,
  missingAltLabel,
  className,
}: MarkdownProps): ReactNode {
  const hasHtml = typeof html === 'string';
  const source = hasHtml ? html : renderLegacyMarkdown(children ?? '');
  const tree = sanitizeHtml(source, !hasHtml);
  return (
    <div className={['minui-markdown', className].filter(Boolean).join(' ')}>
      {toReact(tree, { newTabLabel, missingAltLabel })}
    </div>
  );
}

/**
 * Prévia do editor: converte o Markdown em edição pelo mesmo módulo da gravação e desenha o
 * resultado com o `Markdown`. Prévia e conteúdo persistido não podem divergir (ADR 0027).
 */
export function MarkdownPreview({
  markdown,
  newTabLabel,
  missingAltLabel,
  className,
}: MarkdownPreviewProps): ReactNode {
  return (
    <Markdown
      html={renderMarkdownToHtml(markdown ?? '')}
      newTabLabel={newTabLabel}
      missingAltLabel={missingAltLabel}
      className={className}
    />
  );
}

/** Elementos possíveis no HTML saneado, para consumidores que montam a própria lista. */
export type MarkdownElement = (typeof MARKDOWN_ALLOWED_ELEMENTS)[number];
/** Elementos do Markdown anterior à ADR 0027 (sem imagem). */
export type LegacyMarkdownElement = (typeof MARKDOWN_LEGACY_ELEMENTS)[number];
