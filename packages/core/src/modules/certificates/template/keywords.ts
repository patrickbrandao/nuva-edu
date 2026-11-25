// Palavras-chave do template do certificado (spec 015, "Template"; ADR 0026): lista fechada,
// sintaxe `{{grupo.campo}}` com espaços internos tolerados. Funções puras.

/** As 13 palavras-chave aceitas, na ordem da spec 015. */
export const CERTIFICATE_TEMPLATE_KEYS = [
  'aluno.nome',
  'curso.titulo',
  'curso.carga_horaria',
  'curso.instrutor',
  'certificado.data_conclusao',
  'certificado.data_conclusao_curta',
  'certificado.data_emissao',
  'certificado.codigo',
  'certificado.url_validacao',
  'certificado.qrcode',
  'escola.nome',
  'assinatura.nome',
  'assinatura.cargo',
] as const;
export type CertificateTemplateKey = (typeof CERTIFICATE_TEMPLATE_KEYS)[number];

/** A única palavra-chave que vira marcação (um `<svg>` do sistema), aceita só em texto. */
export const CERTIFICATE_QRCODE_KEY = 'certificado.qrcode' satisfies CertificateTemplateKey;

/** Palavras-chave trocadas por texto: todas menos o QR. */
export type CertificateTemplateTextKey = Exclude<CertificateTemplateKey, 'certificado.qrcode'>;

/** Valores das palavras-chave de texto, já formatados (datas por extenso etc.). */
export type CertificateTemplateValues = Readonly<Record<CertificateTemplateTextKey, string>>;

/** Sempre obrigatórias no template. */
export const CERTIFICATE_TEMPLATE_REQUIRED_KEYS = [
  'aluno.nome',
  'curso.titulo',
  'certificado.codigo',
] as const satisfies readonly CertificateTemplateKey[];

/** O template precisa de ao menos uma destas (a forma de conferir o certificado). */
export const CERTIFICATE_TEMPLATE_VALIDATION_KEYS = [
  'certificado.url_validacao',
  'certificado.qrcode',
] as const satisfies readonly CertificateTemplateKey[];

/** Descrição de cada palavra-chave, mostrada ao lado do editor (spec 015). */
export const CERTIFICATE_TEMPLATE_KEY_DESCRIPTIONS: Readonly<
  Record<CertificateTemplateKey, string>
> = {
  'aluno.nome': 'Nome do aluno: o nome completo ou, se vazio, o nome de exibição, na emissão.',
  'curso.titulo': 'Título do curso.',
  'curso.carga_horaria': 'Carga horária em horas inteiras, só o número.',
  'curso.instrutor': 'Nome de exibição do dono do curso; vazio quando o curso não tem dono.',
  'certificado.data_conclusao': 'Data de conclusão por extenso, no fuso da escola.',
  'certificado.data_conclusao_curta': 'Data de conclusão curta (dia/mês/ano).',
  'certificado.data_emissao': 'Data de emissão por extenso, no fuso da escola.',
  'certificado.codigo': 'Código do certificado, com hífens (XXXX-XXXX-XXXX).',
  'certificado.url_validacao': 'Endereço da página pública que valida o certificado.',
  'certificado.qrcode':
    'Código QR da URL de validação, em SVG gerado pelo sistema. Só em texto, nunca em atributo.',
  'escola.nome': 'Nome da escola.',
  'assinatura.nome': 'Nome de quem assina pela escola; vazio quando não configurado.',
  'assinatura.cargo': 'Cargo de quem assina; vazio quando não configurado.',
};

const KEY_SET: ReadonlySet<string> = new Set(CERTIFICATE_TEMPLATE_KEYS);

/** Verdadeiro para uma das 13 palavras-chave. */
export function isCertificateTemplateKey(value: string): value is CertificateTemplateKey {
  return KEY_SET.has(value);
}

/** Pedaço de um texto depois da busca por palavras-chave. */
export type KeywordToken =
  | { kind: 'text'; value: string }
  | { kind: 'key'; key: CertificateTemplateKey; index: number }
  | { kind: 'unknown'; raw: string; index: number }
  | { kind: 'unclosed'; index: number };

/**
 * Separa um texto em trechos literais e palavras-chave. Todo `{{` abre uma palavra-chave (não há
 * forma de escrever `{{` literal); sem `}}` depois, é `unclosed`. Chave vazia ou fora da lista é
 * `unknown`. `index` é a posição do `{{` no texto.
 */
export function scanKeywords(text: string): KeywordToken[] {
  const tokens: KeywordToken[] = [];
  let position = 0;
  while (position < text.length) {
    const open = text.indexOf('{{', position);
    if (open === -1) {
      tokens.push({ kind: 'text', value: text.slice(position) });
      break;
    }
    if (open > position) {
      tokens.push({ kind: 'text', value: text.slice(position, open) });
    }
    const close = text.indexOf('}}', open + 2);
    if (close === -1) {
      tokens.push({ kind: 'unclosed', index: open });
      break;
    }
    const inner = text.slice(open + 2, close).trim();
    if (isCertificateTemplateKey(inner)) {
      tokens.push({ kind: 'key', key: inner, index: open });
    } else {
      tokens.push({ kind: 'unknown', raw: text.slice(open, close + 2), index: open });
    }
    position = close + 2;
  }
  return tokens;
}

/** Verdadeiro se o texto contém ao menos um `{{`. */
export function hasKeywordMarker(text: string): boolean {
  return text.includes('{{');
}
