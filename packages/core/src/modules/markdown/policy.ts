import type { Schema } from 'hast-util-sanitize';

// Política comum do Markdown (spec 017, RF-05; ADR 0027). É a única fonte da lista de elementos,
// atributos e protocolos: o servidor gera o HTML persistido com ela e a interface repete o mesmo
// saneamento na exibição (tarefa 627). Qualquer ampliação (título, tabela, linha horizontal...)
// exige mudança de spec, não uma exceção local.

/** Elementos permitidos no HTML saneado: parágrafo, ênfases, listas, citação, código e mídia. */
export const MARKDOWN_ALLOWED_ELEMENTS = [
  'p',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
  'code',
  'pre',
  'blockquote',
  'br',
  'img',
] as const;

/** Elementos permitidos na leitura do Markdown antigo (antes da ADR 0027), sem imagem externa. */
export const MARKDOWN_LEGACY_ELEMENTS = MARKDOWN_ALLOWED_ELEMENTS.filter(
  (element) => element !== 'img',
);

/** Protocolos aceitos nos links, em letras minúsculas e sem os dois pontos. */
export const MARKDOWN_LINK_PROTOCOLS = ['https', 'http', 'mailto'] as const;

/** Protocolo aceito nas imagens: só URL absoluta `https` (ADR 0027). */
export const MARKDOWN_IMAGE_PROTOCOLS = ['https'] as const;

/** Atributos que todo link recebe: abre em nova aba, sem passar referência nem autoridade. */
export const MARKDOWN_LINK_ATTRIBUTES = {
  target: '_blank',
  rel: 'nofollow noopener noreferrer',
} as const;

/** Atributos que toda imagem recebe: carga preguiçosa e pedido sem `Referer`. */
export const MARKDOWN_IMAGE_ATTRIBUTES = {
  loading: 'lazy',
  referrerpolicy: 'no-referrer',
} as const;

/**
 * Corpo padrão em Markdown: 20.000 caracteres, o mesmo teto de tópico/resposta do fórum (spec 017,
 * RNF-02) e de novidade (spec 025, RNF-02). Cada recurso passa o próprio limite a
 * `assertMarkdownWithinLimit` — a mensagem de chamado usa 10.000 (spec 023, RNF-02).
 */
export const MARKDOWN_BODY_MAX_LENGTH = 20_000;

/**
 * Esquema explícito do `rehype-sanitize`, sem o perfil padrão. `ancestors` e `attributes` vazios
 * impedem que o padrão GitHub deixe passar atributos ou dependências de ancestral que a política
 * não prevê. `required` repõe os atributos fixos depois do saneamento.
 */
export function markdownSanitizeSchema(options?: {
  /** `true` na leitura de conteúdo antigo: imagens externas não passam a existir. */
  allowImages?: boolean;
}): Schema {
  const allowImages = options?.allowImages !== false;
  return {
    tagNames: [...(allowImages ? MARKDOWN_ALLOWED_ELEMENTS : MARKDOWN_LEGACY_ELEMENTS)],
    attributes: {
      '*': [],
      a: ['href', 'target', 'rel'],
      ol: ['start'],
      ...(allowImages ? { img: ['src', 'alt', 'loading', 'referrerPolicy'] } : {}),
    },
    protocols: {
      href: [...MARKDOWN_LINK_PROTOCOLS],
      ...(allowImages ? { src: [...MARKDOWN_IMAGE_PROTOCOLS] } : {}),
    },
    required: {
      a: { target: MARKDOWN_LINK_ATTRIBUTES.target, rel: MARKDOWN_LINK_ATTRIBUTES.rel },
      ...(allowImages
        ? {
            img: {
              loading: MARKDOWN_IMAGE_ATTRIBUTES.loading,
              referrerPolicy: MARKDOWN_IMAGE_ATTRIBUTES.referrerpolicy,
            },
          }
        : {}),
    },
    ancestors: {},
    allowComments: false,
    allowDoctypes: false,
    strip: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
  };
}

/**
 * Texto do endereço como o navegador o lê antes de resolver: sem tabulação, quebra de linha ou
 * CR em parte alguma e sem espaços/controles C0/C1 nas pontas. Espaço no meio não é apagado: na
 * resolução ele vira `%20`, e removê-lo mudaria o endereço.
 */
function cleanUrl(url: string): string {
  let value = '';
  for (const char of url) {
    if (char === '\t' || char === '\n' || char === '\r') continue;
    value += char;
  }
  let start = 0;
  let end = value.length;
  while (start < end && isEdgeSpace(value.charCodeAt(start))) start += 1;
  while (end > start && isEdgeSpace(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

/** Espaço ou controle que o navegador descarta nas pontas do endereço. */
function isEdgeSpace(code: number): boolean {
  return code <= 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Análise de URL absoluta pela mesma norma do navegador; endereço relativo não é aceito. */
function parseUrl(url: string): URL | null {
  const cleaned = cleanUrl(url);
  if (cleaned === '') return null;
  try {
    return new URL(cleaned);
  } catch {
    return null;
  }
}

/**
 * Protocolo de uma URL absoluta, normalizado em minúsculas e sem os dois pontos. Devolve `null`
 * quando não há esquema absoluto (endereço relativo, `//host/caminho`) ou quando o texto não tem
 * esquema — o mesmo caso do navegador, que trata sem esquema como endereço do próprio site.
 */
export function markdownUrlProtocol(url: string): string | null {
  if (typeof url !== 'string') return null;
  const parsed = parseUrl(url);
  return parsed === null ? null : parsed.protocol.slice(0, -1).toLowerCase();
}

/**
 * `true` quando o endereço é absoluto, tem um dos protocolos da lista e tem destino: autoridade
 * (`//host`) nos protocolos de rede e endereço em `mailto:`. `https:foo` e `mailto:` ficam de
 * fora: nenhum dos dois aponta para um destino completo, e o HTML gravado é lido por consumidores
 * que não aplicam a mesma correção do navegador.
 */
function isAllowedAbsoluteUrl(url: string, protocols: readonly string[]): boolean {
  const parsed = parseUrl(url);
  if (parsed === null) return false;
  const protocol = parsed.protocol.slice(0, -1).toLowerCase();
  if (!protocols.includes(protocol)) return false;
  if (protocol === 'mailto') return parsed.pathname !== '';
  return cleanUrl(url).slice(protocol.length).startsWith('://');
}

/** `true` quando o link pode manter o `href` (só `https`, `http` e `mailto` absolutos). */
export function isAllowedMarkdownLinkUrl(url: string): boolean {
  return isAllowedAbsoluteUrl(url, MARKDOWN_LINK_PROTOCOLS);
}

/** `true` quando a imagem pode existir: URL absoluta `https`, nada relativo nem `data:`. */
export function isAllowedMarkdownImageUrl(url: string): boolean {
  return isAllowedAbsoluteUrl(url, MARKDOWN_IMAGE_PROTOCOLS);
}

/**
 * Endereço normalizado para o HTML: sem os caracteres que o navegador ignora e com o esquema em
 * minúsculas. O `rehype-sanitize` compara o protocolo byte a byte e em minúsculas, então sem esta
 * forma `HTTPS://host` perderia o `href` mesmo sendo permitido. Devolve `null` quando não é
 * permitido.
 */
export function normalizeMarkdownUrl(url: string, kind: 'link' | 'image'): string | null {
  if (typeof url !== 'string') return null;
  const allowed = kind === 'link' ? isAllowedMarkdownLinkUrl(url) : isAllowedMarkdownImageUrl(url);
  if (!allowed) return null;
  const cleaned = cleanUrl(url);
  const protocol = markdownUrlProtocol(cleaned);
  if (protocol === null) return null;
  // Só o esquema muda de caixa; o restante (caminho, consulta) é sensível a maiúsculas.
  return `${protocol}:${cleaned.slice(protocol.length + 1)}`;
}
