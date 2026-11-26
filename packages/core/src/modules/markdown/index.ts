// Markdown saneado compartilhado (spec 017, RF-05; ADR 0027). Módulo isomórfico: as APIs gravam
// `body_md` e o `body_html` gerado aqui na mesma transação, e `packages/ui` reutiliza a política e
// o pipeline na exibição e na prévia (tarefa 627). Nenhum outro módulo monta a própria lista de
// elementos ou protocolos.

export {
  isAllowedMarkdownImageUrl,
  isAllowedMarkdownLinkUrl,
  MARKDOWN_ALLOWED_ELEMENTS,
  MARKDOWN_BODY_MAX_LENGTH,
  MARKDOWN_IMAGE_ATTRIBUTES,
  MARKDOWN_IMAGE_PROTOCOLS,
  MARKDOWN_LEGACY_ELEMENTS,
  MARKDOWN_LINK_ATTRIBUTES,
  MARKDOWN_LINK_PROTOCOLS,
  markdownSanitizeSchema,
  markdownUrlProtocol,
  normalizeMarkdownUrl,
} from './policy.ts';
export {
  assertMarkdownWithinLimit,
  countMarkdownCharacters,
  type MarkdownRenderOptions,
  markdownTooLong,
  type RenderedMarkdown,
  renderLegacyMarkdown,
  renderMarkdown,
  renderMarkdownToHtml,
} from './render.ts';
