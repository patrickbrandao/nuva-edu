import type { RefObject } from 'react';
import type { VideoProvider } from './source';

/** Falha de carregamento ou de reprodução: o site mostra "Abrir em nova aba" e "Reportar problema". */
export interface VideoPlayerError {
  provider: VideoProvider;
  /** `invalid-url`, `script`, `media` ou o código do provedor (ex.: `youtube-150`). */
  reason: string;
}

/** O que cada adaptador informa ao `VideoPlayer`; a cadência do `onTime` é decidida fora dele. */
export interface AdapterEvents {
  time(seconds: number): void;
  pause(seconds?: number): void;
  ended(): void;
  error(reason: string): void;
}

export interface AdapterControl {
  seek(seconds: number): void;
  /** Última posição que o adaptador conhece, em segundos; `null` enquanto o provedor não informou. */
  getCurrentTime(): number | null;
}

export interface AdapterProps {
  /** Posição gravada; o adaptador aplica `resumePosition` com a duração que souber. */
  startAt?: number | undefined;
  /** Duração informada pelo autor (`duration_seconds`), usada enquanto o provedor não diz a sua. */
  durationHint?: number | undefined;
  title: string;
  events: AdapterEvents;
  control: RefObject<AdapterControl | null>;
}

/** Cria o `iframe` fora do React, para a biblioteca do provedor poder trocá-lo ou removê-lo. */
export function createEmbedFrame(src: string, title: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = title;
  iframe.className = 'minui-video__frame';
  iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  return iframe;
}
