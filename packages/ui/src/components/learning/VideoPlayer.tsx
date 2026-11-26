import { type Ref, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import '../../styles/tokens.css';
import './learning.css';
import type { AdapterControl, AdapterEvents, VideoPlayerError } from './video/adapter';
import { BunnyAdapter, PandaAdapter } from './video/message';
import { NativeAdapter, type NativeControlLabels } from './video/native';
import { resolveVideoSource, type VideoProvider } from './video/source';
import { createTimeReporter } from './video/time';
import { VimeoAdapter } from './video/vimeo';
import { YouTubeAdapter } from './video/youtube';

/*
 * Player da página da aula (spec 014; ADR 0025). Um adaptador por `video_provider`, todos com
 * a mesma interface: posição inicial (`startAt`, com a regra dos 10 s finais), `onEnded`,
 * `onTime(seconds)` no máximo a cada 15 s e mais ao pausar, ao terminar e ao sair da página,
 * `seek(seconds)` e `getCurrentTime()` pela `ref` e `onError` para o site mostrar "Abrir em nova aba".
 * `link` (e URL que não bate com o provedor) vira o botão "Abrir vídeo", sem `onEnded`.
 */

export interface VideoPlayerHandle {
  /** Leva o vídeo à posição, em segundos (ex.: a partir de uma nota com tempo). */
  seek(seconds: number): void;
  /**
   * Posição atual, em segundos: a do `<video>` no nativo e a última informada pelo provedor nos
   * demais, sem a cadência de 15 s do `onTime` (ex.: o instante de uma nota de aula). `null`
   * quando o provedor não informa (`link`) ou ainda não informou.
   */
  getCurrentTime(): number | null;
}

export interface VideoPlayerLabels extends NativeControlLabels {
  /** Nome do vídeo para o leitor de tela (o título da aula). */
  title: string;
  /** Texto do botão de `link` (ex.: "Abrir vídeo"). */
  openVideo: string;
  /** Aviso, só para o leitor de tela, de que o link abre em nova aba. */
  newTab: string;
}

export interface VideoPlayerProps {
  src: string;
  provider: VideoProvider;
  /** Posição gravada, em segundos (`position_seconds`). */
  startAt?: number | null | undefined;
  /** Duração informada pelo autor (`duration_seconds`), para a regra dos 10 s finais. */
  duration?: number | null | undefined;
  onEnded?: (() => void) | undefined;
  onTime?: ((seconds: number) => void) | undefined;
  onError?: ((error: VideoPlayerError) => void) | undefined;
  labels: VideoPlayerLabels;
  /** Idioma dos números da velocidade (padrão `pt-BR`). */
  locale?: string;
  className?: string | undefined;
  ref?: Ref<VideoPlayerHandle>;
}

export type { VideoPlayerError } from './video/adapter';

/** Player de vídeo por provedor. Trocar `src` ou `provider` remonta o player do zero. */
export function VideoPlayer(props: VideoPlayerProps) {
  return <PlayerBody key={`${props.provider} ${props.src}`} {...props} />;
}

function PlayerBody({
  src,
  provider,
  startAt,
  duration,
  onEnded,
  onTime,
  onError,
  labels,
  locale = 'pt-BR',
  className,
  ref,
}: VideoPlayerProps) {
  const source = useMemo(() => resolveVideoSource(provider, src), [provider, src]);
  const callbacks = useRef({ onEnded, onTime, onError });
  useEffect(() => {
    callbacks.current = { onEnded, onTime, onError };
  });

  const control = useRef<AdapterControl | null>(null);
  const initialStart = useRef(startAt ?? undefined);
  const reporter = useMemo(
    () =>
      createTimeReporter((seconds) => callbacks.current.onTime?.(seconds), {
        initial: initialStart.current,
      }),
    [],
  );
  const events = useMemo<AdapterEvents>(
    () => ({
      time: (seconds) => reporter.tick(seconds),
      pause: (seconds) => reporter.flush(seconds),
      ended: () => {
        reporter.flush();
        callbacks.current.onEnded?.();
      },
      error: (reason) => callbacks.current.onError?.({ provider, reason }),
    }),
    [reporter, provider],
  );

  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds) => {
        if (Number.isFinite(seconds)) control.current?.seek(Math.max(0, seconds));
      },
      getCurrentTime: () => {
        const seconds = control.current?.getCurrentTime() ?? null;
        return seconds != null && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
      },
    }),
    [],
  );

  // posição ao sair da página (RNF-04) e ao desmontar
  useEffect(() => {
    const flush = () => reporter.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [reporter]);

  useEffect(() => {
    if (source.kind === 'invalid') events.error('invalid-url');
  }, [source, events]);

  const common = {
    startAt: startAt ?? undefined,
    durationHint: duration ?? undefined,
    title: labels.title,
    events,
    control,
  };
  const classes = ['minui-video', className].filter(Boolean).join(' ');

  switch (source.kind) {
    case 'youtube':
      return (
        <div className={classes} data-provider={provider}>
          <YouTubeAdapter id={source.id} {...common} />
        </div>
      );
    case 'vimeo':
      return (
        <div className={classes} data-provider={provider}>
          <VimeoAdapter embedUrl={source.embedUrl} {...common} />
        </div>
      );
    case 'bunny':
      return (
        <div className={classes} data-provider={provider}>
          <div className="minui-video__embed">
            <BunnyAdapter embedUrl={source.embedUrl} origin={source.origin} {...common} />
          </div>
        </div>
      );
    case 'panda':
      return (
        <div className={classes} data-provider={provider}>
          <div className="minui-video__embed">
            <PandaAdapter embedUrl={source.embedUrl} origin={source.origin} {...common} />
          </div>
        </div>
      );
    case 'native':
      return (
        <div className={classes} data-provider={provider}>
          <NativeAdapter
            url={source.url}
            hls={source.hls}
            labels={labels}
            locale={locale}
            {...common}
          />
        </div>
      );
    case 'link':
      return (
        <div className={classes} data-provider="link">
          <a
            className="minui-video__open"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {labels.openVideo}
            <span className="minui-sr-only"> {labels.newTab}</span>
          </a>
        </div>
      );
    default:
      return null;
  }
}
