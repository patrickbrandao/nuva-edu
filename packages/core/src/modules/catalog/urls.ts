// URLs de conteúdo do catálogo (spec 009, "Vídeo e links externos"): validação de qualquer URL
// de conteúdo (vídeo, apoio, ebook, capa externa) e classificação do provedor do vídeo. Funções
// puras: a URL nunca é buscada (evita SSRF); a disponibilidade é conferida pelo navegador.

import { DomainError, type FieldError } from '../../errors/domain-error.ts';

/** RNF-03 da 009: URL até 2.000 caracteres. */
export const CONTENT_URL_MAX_LENGTH = 2000;

/** Provedores de vídeo (`lessons.video_provider`), na ordem da tabela da spec 009. */
export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'bunny', 'panda', 'file', 'link'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** Motivo da recusa de uma URL de conteúdo. */
export type ContentUrlProblem =
  | 'not_text'
  | 'empty'
  | 'too_long'
  | 'whitespace'
  | 'malformed'
  | 'scheme'
  | 'credentials';

export type ContentUrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly problem: ContentUrlProblem };

const PROBLEM_MESSAGES: Readonly<Record<ContentUrlProblem, string>> = {
  not_text: 'Informe a URL como texto.',
  empty: 'Informe a URL.',
  too_long: `A URL passa de ${CONTENT_URL_MAX_LENGTH} caracteres.`,
  whitespace: 'A URL não pode ter espaços.',
  malformed: 'A URL não é válida.',
  scheme: 'Use uma URL https (http só para hosts *.localhost).',
  credentials: 'A URL não pode ter usuário nem senha embutidos.',
};

/** Texto da recusa, para o `message` do campo. */
export function contentUrlProblemMessage(problem: ContentUrlProblem): string {
  return PROBLEM_MESSAGES[problem];
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

/**
 * Confere as regras da spec 009 para qualquer URL de conteúdo: `https` obrigatório (`http` só em
 * `localhost` e `*.localhost`, para desenvolvimento), sem credenciais embutidas, sem espaços, até
 * 2.000 caracteres. Não busca a URL.
 */
export function checkContentUrl(value: unknown): ContentUrlCheck {
  if (typeof value !== 'string') return { ok: false, problem: 'not_text' };
  if (value.length === 0) return { ok: false, problem: 'empty' };
  if (value.length > CONTENT_URL_MAX_LENGTH) return { ok: false, problem: 'too_long' };
  if (/\s/.test(value)) return { ok: false, problem: 'whitespace' };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
  if (scheme !== 'https' && scheme !== 'http') {
    return { ok: false, problem: URL.canParse(value) ? 'scheme' : 'malformed' };
  }
  if (!URL.canParse(value)) return { ok: false, problem: 'malformed' };
  const url = new URL(value);
  if (url.hostname === '') return { ok: false, problem: 'malformed' };
  // `https://@host` deixa `username` vazio, mas a arroba na autoridade ainda é credencial.
  const authority = value.slice(scheme.length + 3).split(/[/?#]/, 1)[0] ?? '';
  if (url.username !== '' || url.password !== '' || authority.includes('@')) {
    return { ok: false, problem: 'credentials' };
  }
  if (scheme === 'http' && !isLocalhost(url.hostname)) return { ok: false, problem: 'scheme' };
  return { ok: true, url };
}

/** `422` `content_url_invalid` com os campos recusados (spec 009, "Casos de erro"). */
export function contentUrlInvalid(errors: readonly FieldError[]): DomainError {
  return new DomainError({
    code: 'content_url_invalid',
    status: 422,
    title: 'URL fora das regras',
    detail: errors.map((error) => `${error.path}: ${error.message}`).join(' '),
    errors,
  });
}

/**
 * Valida a URL do campo `path` e devolve o texto como veio (a gravação guarda o que o autor
 * informou). Fora das regras: `422` `content_url_invalid` com o campo e o motivo.
 */
export function assertContentUrl(value: unknown, path: string): string {
  const check = checkContentUrl(value);
  if (!check.ok) {
    throw contentUrlInvalid([{ path, message: contentUrlProblemMessage(check.problem) }]);
  }
  return value as string;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);
const PANDA_HOST = /^player-vz-[a-z0-9-]+\.tv\.pandavideo\.com\.br$/;

/** Primeiro segmento do caminho depois do prefixo, se não for vazio. */
function segmentAfter(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split('/', 1)[0] ?? '';
  return segment === '' ? null : segment;
}

function isYoutube(url: URL, host: string): boolean {
  if (host === 'youtu.be') return segmentAfter(url.pathname, '/') !== null;
  if (!YOUTUBE_HOSTS.has(host)) return false;
  if (url.pathname === '/watch') return (url.searchParams.get('v') ?? '') !== '';
  return (
    segmentAfter(url.pathname, '/embed/') !== null || segmentAfter(url.pathname, '/live/') !== null
  );
}

function isVimeo(url: URL, host: string): boolean {
  if (host === 'player.vimeo.com') {
    return /^\d+$/.test(segmentAfter(url.pathname, '/video/') ?? '');
  }
  return VIMEO_HOSTS.has(host) && /^\d+$/.test(segmentAfter(url.pathname, '/') ?? '');
}

function isBunny(url: URL, host: string, path: string): boolean {
  if (host === 'iframe.mediadelivery.net') return segmentAfter(url.pathname, '/embed/') !== null;
  // HLS só a partir dos hosts da tabela (resposta à P5 da tarefa 400).
  return host.endsWith('.b-cdn.net') && path.endsWith('.m3u8');
}

/**
 * Classifica o provedor de uma URL de vídeo já validada (spec 009, tabela de provedores; P5 da
 * tarefa 400): `.m3u8` só é `bunny` em `*.b-cdn.net` e vira `link` em outro host; `file` é só
 * `.mp4` e `.webm`; o que não casa com nenhum padrão é `link`.
 */
export function classifyVideoProvider(value: string | URL): VideoProvider {
  const url = typeof value === 'string' ? new URL(value) : value;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (isYoutube(url, host)) return 'youtube';
  if (isVimeo(url, host)) return 'vimeo';
  if (isBunny(url, host, path)) return 'bunny';
  // O embed do Panda leva o vídeo na consulta (`/embed/?v=...`).
  if (PANDA_HOST.test(host) && url.pathname.startsWith('/embed/')) return 'panda';
  if (path.endsWith('.mp4') || path.endsWith('.webm')) return 'file';
  return 'link';
}

/** Valida a URL de vídeo (campo `path`) e devolve a URL com o provedor classificado. */
export function parseVideoUrl(
  value: unknown,
  path: string,
): { videoUrl: string; videoProvider: VideoProvider } {
  const videoUrl = assertContentUrl(value, path);
  return { videoUrl, videoProvider: classifyVideoProvider(videoUrl) };
}
