import { useEffect, useId, useRef, useState } from 'react';
import type { AdapterProps } from './adapter';
import { resumePosition } from './time';

/*
 * Vídeo nativo (`file`: `.mp4` e `.webm` de qualquer host `https`) e HLS da Bunny
 * (`*.b-cdn.net/...m3u8`, spec 009, P5). Controles da spec 014: os do próprio `<video>`
 * (reproduzir, posição, volume, tela cheia) e uma barra com voltar e avançar 10 s,
 * velocidade de 0,5× a 2×, volume, tela cheia e imagem sobre imagem.
 * HLS: o `<video>` toca sozinho onde o navegador sabe (Safari); nos outros, `hls.js`,
 * importado sob demanda (pedaço próprio do bundle, sem script externo).
 */

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SKIP_SECONDS = 10;
const HLS_TYPE = 'application/vnd.apple.mpegurl';

type Pending = Promise<unknown>;
type PipVideo = HTMLVideoElement & { requestPictureInPicture?: () => Pending };
type PipDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Pending;
};

export interface NativeControlLabels {
  controls: string;
  rewind: string;
  forward: string;
  speed: string;
  volume: string;
  fullscreen: string;
  pictureInPicture: string;
}

type NativeProps = AdapterProps & {
  url: string;
  hls: boolean;
  labels: NativeControlLabels;
  locale: string;
};

export function NativeAdapter({
  url,
  hls,
  startAt,
  durationHint,
  title,
  events,
  control,
  labels,
  locale,
}: NativeProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumed = useRef(false);
  const initial = useRef({ startAt, durationHint });
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const speedId = useId();
  const volumeId = useId();
  const canPip =
    typeof document !== 'undefined' && (document as PipDocument).pictureInPictureEnabled === true;
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    control.current = {
      seek: (seconds) => {
        video.currentTime = seconds;
      },
      getCurrentTime: () => video.currentTime,
    };
    return () => {
      control.current = null;
    };
  }, [control]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!hls || video.canPlayType(HLS_TYPE)) {
      // o VideoPlayer remonta o adaptador quando a URL muda: não há troca de `src` aqui
      video.src = url;
      return;
    }
    let disposed = false;
    let instance: import('hls.js').default | null = null;
    import('hls.js')
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          events.error('hls-unsupported');
          return;
        }
        const h = new Hls();
        instance = h;
        h.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) events.error(`hls-${data.type}`);
        });
        h.loadSource(url);
        h.attachMedia(video);
      })
      .catch(() => {
        if (!disposed) events.error('hls-load');
      });
    return () => {
      disposed = true;
      instance?.destroy();
    };
  }, [url, hls, events]);

  const video = () => videoRef.current;
  const skip = (delta: number) => {
    const v = video();
    if (!v) return;
    const end = Number.isFinite(v.duration) ? v.duration : Number.POSITIVE_INFINITY;
    v.currentTime = Math.min(end, Math.max(0, v.currentTime + delta));
  };
  const changeRate = (next: number) => {
    setRate(next);
    const v = video();
    if (v) v.playbackRate = next;
  };
  const changeVolume = (next: number) => {
    setVolume(next);
    const v = video();
    if (v) {
      v.volume = next;
      v.muted = next === 0;
    }
  };
  const togglePip = () => {
    const v = video() as PipVideo | null;
    const doc = document as PipDocument;
    if (doc.pictureInPictureElement) doc.exitPictureInPicture?.().catch(() => {});
    else v?.requestPictureInPicture?.().catch(() => {});
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else boxRef.current?.requestFullscreen().catch(() => {});
  };
  const rateText = (value: number) =>
    `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}×`;

  return (
    <div ref={boxRef} className="minui-video__native">
      {/* biome-ignore lint/a11y/useMediaCaption: vídeo externo informado pelo autor, sem legenda cadastrada (spec 009) */}
      <video
        ref={videoRef}
        className="minui-video__media"
        controls
        playsInline
        preload="metadata"
        aria-label={title}
        onLoadedMetadata={(event) => {
          if (resumed.current) return;
          resumed.current = true;
          const v = event.currentTarget;
          const duration = Number.isFinite(v.duration) ? v.duration : initial.current.durationHint;
          const position = resumePosition(initial.current.startAt, duration);
          if (position > 0) v.currentTime = position;
        }}
        onTimeUpdate={(event) => events.time(event.currentTarget.currentTime)}
        onPause={(event) => events.pause(event.currentTarget.currentTime)}
        onEnded={(event) => {
          events.pause(event.currentTarget.currentTime);
          events.ended();
        }}
        onError={() => events.error('media')}
        onVolumeChange={(event) => {
          const v = event.currentTarget;
          setVolume(v.muted ? 0 : v.volume);
        }}
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
      />
      <div className="minui-video__bar" role="toolbar" aria-label={labels.controls}>
        <button type="button" className="minui-video__button" onClick={() => skip(-SKIP_SECONDS)}>
          {labels.rewind}
        </button>
        <button type="button" className="minui-video__button" onClick={() => skip(SKIP_SECONDS)}>
          {labels.forward}
        </button>
        <label className="minui-video__field" htmlFor={speedId}>
          <span>{labels.speed}</span>
          <select
            id={speedId}
            className="minui-video__select"
            value={String(rate)}
            onChange={(event) => changeRate(Number(event.currentTarget.value))}
          >
            {PLAYBACK_RATES.map((value) => (
              <option key={value} value={String(value)}>
                {rateText(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="minui-video__field" htmlFor={volumeId}>
          <span>{labels.volume}</span>
          <input
            id={volumeId}
            className="minui-video__range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => changeVolume(Number(event.currentTarget.value))}
          />
        </label>
        {canPip ? (
          <button type="button" className="minui-video__button" onClick={togglePip}>
            {labels.pictureInPicture}
          </button>
        ) : null}
        {canFullscreen ? (
          <button type="button" className="minui-video__button" onClick={toggleFullscreen}>
            {labels.fullscreen}
          </button>
        ) : null}
      </div>
    </div>
  );
}
