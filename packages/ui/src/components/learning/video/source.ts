/*
 * Classificação da URL de vídeo para o player (spec 009, "Vídeo e links externos"; ADR 0025).
 *
 * A API já grava `video_provider`, mas o player confere de novo: um `iframe` só é montado
 * para os hosts da tabela da 009, e HLS só para `*.b-cdn.net`. URL que não bate com o
 * provedor informado cai no botão "Abrir vídeo" (`link`), nunca num `iframe` qualquer.
 */

export type VideoProvider = 'youtube' | 'vimeo' | 'bunny' | 'panda' | 'file' | 'link';

export type VideoSource =
  | { kind: 'youtube'; id: string }
  | { kind: 'vimeo'; embedUrl: string }
  | { kind: 'bunny'; embedUrl: string; origin: string }
  | { kind: 'panda'; embedUrl: string; origin: string }
  | { kind: 'native'; url: string; hls: boolean }
  | { kind: 'link'; url: string }
  | { kind: 'invalid' };

/** Origem do `iframe` da Bunny Stream. */
export const BUNNY_IFRAME_ORIGIN = 'https://iframe.mediadelivery.net';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);
const PANDA_HOST = /^player-vz-[a-z0-9-]+\.tv\.pandavideo\.com\.br$/;
const BUNNY_CDN_HOST = /^[a-z0-9-]+\.b-cdn\.net$/;

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** `https`, ou `http` só para `localhost`/`*.localhost` (009, regras de validação). */
export function isSafeVideoUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
  );
}

/** Id do vídeo do YouTube nas formas `watch?v=`, `youtu.be/`, `/embed/` e `/live/`. */
export function youtubeVideoId(raw: string): string | null {
  const url = parse(raw);
  if (url?.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined = null;
  if (host === 'youtu.be') id = segments[0];
  else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') id = url.searchParams.get('v');
    else if (segments[0] === 'embed' || segments[0] === 'live') id = segments[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** Endereço do `iframe` do Vimeo (`player.vimeo.com/video/<id>`), com o hash de vídeo não listado. */
export function vimeoEmbedUrl(raw: string): string | null {
  const url = parse(raw);
  if (url?.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  let hash: string | null | undefined;
  if (VIMEO_HOSTS.has(host)) {
    id = segments[0];
    hash = segments[1];
  } else if (host === 'player.vimeo.com' && segments[0] === 'video') {
    id = segments[1];
    hash = url.searchParams.get('h');
  }
  if (!id || !/^\d+$/.test(id)) return null;
  const embed = new URL(`https://player.vimeo.com/video/${id}`);
  if (hash && /^[A-Za-z0-9]+$/.test(hash)) embed.searchParams.set('h', hash);
  // dnt=1: o Vimeo não grava cookie nem estatística de sessão (equivalente ao youtube-nocookie)
  embed.searchParams.set('dnt', '1');
  return embed.toString();
}

/** Decide como o vídeo é tocado a partir do provedor gravado e da URL. */
export function resolveVideoSource(provider: VideoProvider, raw: string): VideoSource {
  const url = parse(raw);
  if (!url || !isSafeVideoUrl(url)) return { kind: 'invalid' };
  const link: VideoSource = { kind: 'link', url: url.toString() };
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  switch (provider) {
    case 'youtube': {
      const id = youtubeVideoId(raw);
      return id ? { kind: 'youtube', id } : link;
    }
    case 'vimeo': {
      const embedUrl = vimeoEmbedUrl(raw);
      return embedUrl ? { kind: 'vimeo', embedUrl } : link;
    }
    case 'bunny':
      if (url.origin === BUNNY_IFRAME_ORIGIN && path.startsWith('/embed/')) {
        return { kind: 'bunny', embedUrl: url.toString(), origin: BUNNY_IFRAME_ORIGIN };
      }
      if (url.protocol === 'https:' && BUNNY_CDN_HOST.test(host) && path.endsWith('.m3u8')) {
        return { kind: 'native', url: url.toString(), hls: true };
      }
      return link;
    case 'panda':
      if (url.protocol === 'https:' && PANDA_HOST.test(host) && path.startsWith('/embed/')) {
        return { kind: 'panda', embedUrl: url.toString(), origin: url.origin };
      }
      return link;
    case 'file':
      return path.endsWith('.mp4') || path.endsWith('.webm')
        ? { kind: 'native', url: url.toString(), hls: false }
        : link;
    default:
      return link;
  }
}
