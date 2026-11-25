import { useLayoutEffect, useRef } from 'react';
import type { AdapterProps } from './adapter';
import { resumePosition } from './time';

/*
 * Bunny e Panda por `postMessage` do próprio `iframe`, sem script externo (ADR 0025).
 * Só são aceitas mensagens com `event.source` igual à janela do `iframe` e `event.origin`
 * igual à origem dele; os comandos vão com essa origem como destino (nunca `*`).
 * O ouvinte é ligado em `useLayoutEffect`, antes de o `iframe` carregar, para não perder o
 * aviso de pronto, que cada provedor manda uma vez só.
 *
 * Bunny Stream — protocolo player.js (https://bunny.net/docs/stream/playback-api;
 * https://github.com/embedly/player.js/blob/master/SPEC.rst): mensagens em JSON com
 * `context: 'player.js'`. O pai manda `{ context, version, method, value }`; o `iframe`
 * responde `{ context, version, event, value }`. `ready` chega sem pedido, com a lista de
 * métodos; os demais eventos só depois de `addEventListener`. `timeupdate` traz
 * `{ seconds, duration }`; `error` de comando traz `{ code, msg }` (2: método inválido;
 * 5: chamada recusada) e o de mídia vem sem dados.
 *
 * Panda Video — https://docs.pandavideo.com/reference/receive-events e
 * https://docs.pandavideo.com/reference/send-events: o `iframe` manda objetos com
 * `message: 'panda_<evento>'` (`panda_ready`, `panda_timeupdate` com `currentTime`,
 * `panda_pause`, `panda_ended`, `panda_error`); o pai manda `{ type, parameter }`, e
 * `{ type: 'currentTime', parameter: segundos }` posiciona o vídeo. Não há método documentado
 * para ler a duração: a retomada usa a duração informada pelo autor.
 */

export const PLAYERJS_VERSION = '0.0.11';
const BUNNY_EVENTS = ['timeupdate', 'pause', 'ended', 'error'] as const;

type Json = Record<string, unknown>;

function asObject(data: unknown): Json | null {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === 'object' ? (parsed as Json) : null;
    } catch {
      return null;
    }
  }
  return data && typeof data === 'object' ? (data as Json) : null;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type FrameProps = AdapterProps & { embedUrl: string; origin: string };

function useFrameMessages(
  origin: string,
  handle: (data: Json, send: (message: unknown) => void) => void,
) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const send = (message: unknown) => frame.contentWindow?.postMessage(message, origin);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      const data = asObject(event.data);
      if (data) handleRef.current(data, send);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin]);

  return frameRef;
}

export function BunnyAdapter({
  embedUrl,
  origin,
  startAt,
  durationHint,
  title,
  events,
  control,
}: FrameProps) {
  const state = useRef({ ready: false, resumed: false, seconds: undefined as number | undefined });

  const frameRef = useFrameMessages(origin, (data, post) => {
    if (data.context !== 'player.js') return;
    const send = (method: string, value?: unknown) =>
      post(
        JSON.stringify({
          context: 'player.js',
          version: PLAYERJS_VERSION,
          method,
          ...(value === undefined ? {} : { value }),
        }),
      );
    const s = state.current;
    const value = asObject(data.value);
    const resume = (duration: number | undefined) => {
      if (s.resumed) return;
      s.resumed = true;
      const position = resumePosition(startAt, duration || durationHint);
      if (position > 0) send('setCurrentTime', position);
    };

    switch (data.event) {
      case 'ready': {
        if (s.ready) return;
        s.ready = true;
        for (const name of BUNNY_EVENTS) send('addEventListener', name);
        control.current = { seek: (seconds) => send('setCurrentTime', seconds) };
        const methods = Array.isArray(value?.methods) ? value.methods : [];
        if (methods.includes('getDuration')) send('getDuration');
        else resume(undefined);
        return;
      }
      case 'getDuration':
        resume(num(data.value));
        return;
      case 'timeupdate': {
        const seconds = num(value?.seconds);
        if (seconds === undefined) return;
        s.seconds = seconds;
        events.time(seconds);
        return;
      }
      case 'pause':
        events.pause(s.seconds);
        return;
      case 'ended':
        events.pause(s.seconds);
        events.ended();
        return;
      case 'error': {
        const code = num(value?.code);
        // 2 e 5 são falhas de um comando nosso, não do vídeo
        if (code === 2 || code === 5) return;
        events.error(code === undefined ? 'bunny-media' : `bunny-${code}`);
        return;
      }
      default:
    }
  });

  return (
    <iframe
      ref={frameRef}
      src={embedUrl}
      title={title}
      className="minui-video__frame"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

export function PandaAdapter({
  embedUrl,
  origin,
  startAt,
  durationHint,
  title,
  events,
  control,
}: FrameProps) {
  const state = useRef({ ready: false, seconds: undefined as number | undefined });

  const frameRef = useFrameMessages(origin, (data, post) => {
    const s = state.current;
    switch (data.message) {
      case 'panda_ready': {
        if (s.ready) return;
        s.ready = true;
        control.current = {
          seek: (seconds) => post({ type: 'currentTime', parameter: seconds }),
        };
        const position = resumePosition(startAt, durationHint);
        if (position > 0) post({ type: 'currentTime', parameter: position });
        return;
      }
      case 'panda_timeupdate': {
        const seconds = num(data.currentTime);
        if (seconds === undefined) return;
        s.seconds = seconds;
        events.time(seconds);
        return;
      }
      case 'panda_pause':
        events.pause(num(data.currentTime) ?? s.seconds);
        return;
      case 'panda_ended':
        events.pause(num(data.currentTime) ?? s.seconds);
        events.ended();
        return;
      case 'panda_error':
        events.error('panda-media');
        return;
      default:
    }
  });

  return (
    <iframe
      ref={frameRef}
      src={embedUrl}
      title={title}
      className="minui-video__frame"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
