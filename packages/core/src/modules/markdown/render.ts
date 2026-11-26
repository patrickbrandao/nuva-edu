import type { Root as MdastRoot } from 'mdast';
import type { Handler, Handlers } from 'mdast-util-to-hast';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { type Plugin, unified } from 'unified';
import { businessRule, type DomainError } from '../../errors/domain-error.ts';
import { markdownSanitizeSchema, normalizeMarkdownUrl } from './policy.ts';

// Pipeline isomórfico do Markdown (ADR 0027): roda igual em Node e no navegador, sem `process`,
// `Buffer` ou DOM. O servidor é a autoridade — grava `body_md` e o HTML daqui na mesma transação —
// e a interface repete o mesmo módulo na prévia e no conteúdo antigo, para que prévia e publicação
// não divirjam.

/** Opções da conversão de Markdown em HTML saneado. */
export interface MarkdownRenderOptions {
  /**
   * `true` na leitura de conteúdo gravado antes da ADR 0027 (descrições e notas): imagens
   * externas não passam a existir retroativamente e o HTML escrito pelo usuário vira texto.
   * O padrão (`false`) é o das novas escritas de fórum, chamados, eventos e novidades.
   */
  legacy?: boolean;
}

/** Markdown original e o HTML saneado que deve ser persistido junto dele. */
export interface RenderedMarkdown {
  markdown: string;
  html: string;
}

/** Número de caracteres do Markdown (pontos de código Unicode), como a spec 017 conta. */
export function countMarkdownCharacters(text: string): number {
  return [...text].length;
}

/** `422 markdown_too_long`, quando o corpo passa do limite do recurso. */
export function markdownTooLong(maxLength: number): DomainError {
  return businessRule(
    'markdown_too_long',
    `O texto tem mais de ${maxLength.toLocaleString('pt-BR')} caracteres.`,
  );
}

/** Confere o tipo e o limite do Markdown antes de renderizar e gravar. Devolve o próprio texto. */
export function assertMarkdownWithinLimit(markdown: unknown, maxLength: number): string {
  if (typeof markdown !== 'string') {
    throw businessRule('markdown_invalid', 'Informe o texto em Markdown.');
  }
  if (countMarkdownCharacters(markdown) > maxLength) throw markdownTooLong(maxLength);
  return markdown;
}

type MdastChild = MdastRoot['children'][number];

/** Nó de mdast com campos mutáveis: as trocas abaixo preservam a identidade do objeto. */
type MutableNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string;
  children?: MdastChild[];
};

function childrenOf(node: MdastChild | MdastRoot): MdastChild[] {
  return 'children' in node && Array.isArray(node.children) ? (node.children as MdastChild[]) : [];
}

/**
 * Nós `html` do mdast viram texto: a marcação que a pessoa escreveu aparece escapada, nunca é
 * interpretada. Sem isso o `remark-rehype` simplesmente descartaria esses nós, apagando o texto
 * junto — e o conteúdo antigo deixaria de mostrar o HTML como texto (ADR 0027).
 */
function rawHtmlAsText(tree: MdastRoot): void {
  const visit = (node: MdastChild | MdastRoot): void => {
    if (node.type === 'html') {
      Object.assign(node, { type: 'text', value: node.value });
      return;
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(tree);
}

const remarkRawHtmlAsText: Plugin<[], MdastRoot, MdastRoot> = () => rawHtmlAsText;

/**
 * Política de URLs aplicada antes do saneamento, sobre o mdast: o `rehype-sanitize` aceita URL
 * relativa e diferencia protocolo só em minúsculas, então sozinho ele deixaria `[a](/x)` ativo e
 * recusaria `[a](HTTPS://host)` — o contrário do que a ADR manda nos dois casos.
 *
 * - link fora de `https`/`http`/`mailto`: vira o tipo interno `markdownPlain`, que o conversor
 *   desembrulha (o link deixa de existir e o texto — inclusive ênfases — permanece);
 * - imagem fora de `https` absoluto: é descartada, preservando o texto alternativo;
 * - link e imagem por referência (`[a][b]`, `![a][b]`) são resolvidos aqui, com o endereço da
 *   definição, para passarem pela mesma conferência;
 * - títulos (`title`) não entram no HTML: a lista comum prevê só os atributos fixos.
 */
function enforceUrlPolicy(tree: MdastRoot, allowImages: boolean): void {
  const definitions = definitionUrls(tree);

  const visit = (node: MdastChild | MdastRoot): void => {
    const mutable = node as MutableNode;
    if (mutable.type === 'link' || mutable.type === 'linkReference') {
      const href = normalizeMarkdownUrl(resolveUrl(mutable, definitions), 'link');
      if (href === null) {
        mutable.type = 'markdownPlain';
        delete mutable.url;
      } else {
        Object.assign(mutable, { type: 'link', url: href });
      }
      delete mutable.title;
    } else if (mutable.type === 'image' || mutable.type === 'imageReference') {
      const src = allowImages
        ? normalizeMarkdownUrl(resolveUrl(mutable, definitions), 'image')
        : null;
      if (src !== null) {
        Object.assign(mutable, { type: 'image', url: src });
        delete mutable.title;
      } else {
        const alt = mutable.alt ?? '';
        delete mutable.url;
        delete mutable.title;
        Object.assign(mutable, { type: 'text', value: alt });
      }
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(tree);
}

/** Definições de referência do documento (`[b]: https://...`), por identificador em maiúsculas. */
function definitionUrls(tree: MdastRoot): Map<string, string> {
  const definitions = new Map<string, string>();
  const visit = (node: MdastChild | MdastRoot): void => {
    const definition = node as { type: string; identifier?: string; url?: string };
    if (definition.type === 'definition' && definition.identifier) {
      definitions.set(definition.identifier.toUpperCase(), definition.url ?? '');
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(tree);
  return definitions;
}

/** Endereço de um link/imagem inline (`url`) ou por referência (`identifier` → definição). */
function resolveUrl(node: MutableNode, definitions: Map<string, string>): string {
  if (node.type === 'link' || node.type === 'image') return node.url ?? '';
  const identifier = (node as { identifier?: string }).identifier ?? '';
  return definitions.get(identifier.toUpperCase()) ?? '';
}

/** Desembrulha o link proibido: devolve os filhos já convertidos, sem elemento próprio. */
const plainChildren: Handler = (state, node) => state.all(node);

/** Monta o processador; `legacy` lê o Markdown antigo sem imagem externa. */
function createProcessor(legacy: boolean) {
  return unified()
    .use(remarkParse)
    .use(remarkRawHtmlAsText)
    .use(() => (tree: MdastRoot) => enforceUrlPolicy(tree, !legacy))
    .use(remarkRehype, {
      allowDangerousHtml: false,
      // `markdownPlain` é um tipo só nosso; o registro por nome evita o `Handlers` fechado.
      handlers: { markdownPlain: plainChildren } as Handlers,
    })
    .use(rehypeSanitize, markdownSanitizeSchema({ allowImages: !legacy }))
    .use(rehypeStringify);
}

/**
 * Converte Markdown em HTML seguro. Determinística e síncrona: a mesma entrada produz exatamente
 * a mesma string no servidor e no navegador, o que permite à tarefa 627 conferir a paridade da
 * prévia com o HTML persistido. HTML bruto nunca é interpretado nem gravado como elemento.
 */
export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
  if (typeof markdown !== 'string') return '';
  const processor = createProcessor(options?.legacy === true);
  const file = processor.processSync(markdown);
  return String(file);
}

/** Renderiza e já devolve o par que a gravação persiste (`body_md` e `body_html`). */
export function renderMarkdown(
  markdown: string,
  options?: MarkdownRenderOptions,
): RenderedMarkdown {
  return { markdown, html: renderMarkdownToHtml(markdown, options) };
}

/**
 * Leitura de conteúdo anterior à ADR 0027: enquanto só existir Markdown, renderiza pela política
 * segura comum, sem imagem externa e com o HTML do usuário aparecendo como texto.
 */
export function renderLegacyMarkdown(markdown: string): string {
  return renderMarkdownToHtml(markdown, { legacy: true });
}
