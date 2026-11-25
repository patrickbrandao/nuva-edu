import { useEffect, useRef } from 'react';
import { type AdapterProps, createEmbedFrame } from './adapter';
import { resumePosition } from './time';

/*
 * YouTube pela IFrame Player API (ADR 0025): o script é carregado sob demanda, só quando uma
 * aula do YouTube é aberta, e é o único script externo dos players. O `iframe` aponta para
 * `youtube-nocookie.com` e é montado por nós (com `enablejsapi=1` e `origin`), forma que a
 * documentação aceita para ligar a API a um `iframe` existente. A API não tem evento de tempo:
 * o tempo é lido a cada segundo enquanto o vídeo toca.
 */

export const YOUTUBE_API_URL = 'https://www.youtube.com/iframe_api';
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_ENDED = 0;
const POLL_MS = 1000;

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

type YTWindow = Window & { YT?: Partial<YTNamespace>; onYouTubeIframeAPIReady?: () => void };

let pending: Promise<YTNamespace> | null = null;

/** Carrega a IFrame API uma vez por página; resolve na hora se ela já estiver presente. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as YTWindow;
  if (typeof w.YT?.Player === 'function') return Promise.resolve(w.YT as YTNamespace);
  if (pending) return pending;
  pending = new Promise<YTNamespace>((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (typeof w.YT?.Player === 'function') resolve(w.YT as YTNamespace);
      else reject(new Error('youtube-api'));
    };
    const script = document.createElement('script');
    script.src = YOUTUBE_API_URL;
    script.async = true;
    script.onerror = () => {
      pending = null;
      script.remove();
      reject(new Error('youtube-api'));
    };
    document.head.appendChild(script);
  });
  return pending;
}

/** Só para os testes: esquece o carregamento anterior. */
export function resetYouTubeApiForTests(): void {
  pending = null;
}

export function youtubeEmbedUrl(id: string, start: number, origin: string): string {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('origin', origin);
  url.searchParams.set('rel', '0');
  url.searchParams.set('playsinline', '1');
  if (start > 0) url.searchParams.set('start', String(Math.floor(start)));
  return url.toString();
}

export function YouTubeAdapter({
  id,
  startAt,
  durationHint,
  title,
  events,
  control,
}: AdapterProps & { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initial = useRef({ startAt, durationHint, title });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { startAt: at, durationHint: hint, title: name } = initial.current;
    const iframe = createEmbedFrame(
      youtubeEmbedUrl(id, resumePosition(at, hint), window.location.origin),
      name,
    );
    host.appendChild(iframe);
    let disposed = false;
    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const now = () => player?.getCurrentTime() ?? 0;

    loadYouTubeApi().then(
      (YT) => {
        if (disposed) return;
        player = new YT.Player(iframe, {
          events: {
            onReady: () => {
              control.current = { seek: (seconds) => player?.seekTo(seconds, true) };
            },
            onStateChange: ({ data }) => {
              if (data === YT_PLAYING) {
                if (timer === undefined) timer = setInterval(() => events.time(now()), POLL_MS);
                return;
              }
              stop();
              if (data === YT_PAUSED) events.pause(now());
              if (data === YT_ENDED) {
                events.pause(now());
                events.ended();
              }
            },
            onError: ({ data }) => events.error(`youtube-${data}`),
          },
        });
      },
      () => {
        if (!disposed) events.error('script');
      },
    );

    return () => {
      disposed = true;
      stop();
      control.current = null;
      if (player) player.destroy();
      iframe.remove();
    };
  }, [id, events, control]);

  return <div ref={hostRef} className="minui-video__embed" />;
}
