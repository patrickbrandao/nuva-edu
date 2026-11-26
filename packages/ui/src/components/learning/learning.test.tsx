import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityHeatmap,
  type ActivityHeatmapLabels,
  activityLevel,
  buildActivityGrid,
  RESUME_TAIL_SECONDS,
  resolveVideoSource,
  resumePosition,
  TIME_REPORT_INTERVAL_MS,
  VideoPlayer,
  type VideoPlayerHandle,
  type VideoPlayerLabels,
  type VideoProvider,
} from '../../index';
import { expectNoAxeViolations } from '../../test/axe';
import { PLAYERJS_VERSION } from './video/message';
import { createTimeReporter } from './video/time';
import { resetYouTubeApiForTests, YOUTUBE_API_URL } from './video/youtube';

/* ------------------------------------------------------------ fakes dos provedores */

const vimeo = vi.hoisted(() => {
  type Handler = (data: unknown) => void;
  class FakeVimeo {
    static last: FakeVimeo | null = null;
    handlers = new Map<string, Handler>();
    setCurrentTime = vi.fn(() => Promise.resolve(0));
    destroy = vi.fn(() => Promise.resolve());
    duration = 600;
    constructor(public element: HTMLIFrameElement) {
      FakeVimeo.last = this;
    }
    on(name: string, handler: Handler) {
      this.handlers.set(name, handler);
    }
    ready() {
      return Promise.resolve();
    }
    getDuration() {
      return Promise.resolve(this.duration);
    }
    emit(name: string, data?: unknown) {
      this.handlers.get(name)?.(data);
    }
  }
  return { FakeVimeo };
});
vi.mock('@vimeo/player', () => ({ default: vimeo.FakeVimeo }));

const hls = vi.hoisted(() => {
  class FakeHls {
    static last: FakeHls | null = null;
    static supported = true;
    static isSupported() {
      return FakeHls.supported;
    }
    static Events = { ERROR: 'hlsError' };
    handlers = new Map<string, (event: string, data: unknown) => void>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      FakeHls.last = this;
    }
    on(name: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(name, handler);
    }
  }
  return { FakeHls };
});
vi.mock('hls.js', () => ({ default: hls.FakeHls }));

interface YTOptions {
  events: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
}
class FakeYouTube {
  static last: FakeYouTube | null = null;
  time = 0;
  seekTo = vi.fn();
  destroy = vi.fn();
  constructor(
    public element: HTMLIFrameElement,
    public options: YTOptions,
  ) {
    FakeYouTube.last = this;
  }
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return 600;
  }
}

type YTWindow = Window & { YT?: unknown; onYouTubeIframeAPIReady?: () => void };

/* ------------------------------------------------------------ apoio */

const labels: VideoPlayerLabels = {
  title: 'Aula 1: introdução',
  openVideo: 'Abrir vídeo',
  newTab: '(abre em nova aba)',
  controls: 'Controles do vídeo',
  rewind: 'Voltar 10 s',
  forward: 'Avançar 10 s',
  speed: 'Velocidade',
  volume: 'Volume',
  fullscreen: 'Tela cheia',
  pictureInPicture: 'Imagem sobre imagem',
};

const URLS: Record<Exclude<VideoProvider, 'link'>, string> = {
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  vimeo: 'https://vimeo.com/76979871',
  bunny: 'https://iframe.mediadelivery.net/embed/1234/abcd-ef',
  panda: 'https://player-vz-ded14ebd-85a.tv.pandavideo.com.br/embed/?v=3b101f05',
  file: 'https://cdn.example.com/aula.mp4',
};
const PANDA_ORIGIN = 'https://player-vz-ded14ebd-85a.tv.pandavideo.com.br';
const BUNNY_ORIGIN = 'https://iframe.mediadelivery.net';

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

function frame(container: HTMLElement): HTMLIFrameElement {
  const iframe = container.querySelector('iframe');
  if (!iframe) throw new Error('sem iframe');
  return iframe;
}

function fromFrame(iframe: HTMLIFrameElement, data: unknown, origin: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin, source: iframe.contentWindow }),
    );
  });
}

function spyPost(iframe: HTMLIFrameElement) {
  const win = iframe.contentWindow;
  if (!win) throw new Error('sem contentWindow');
  return vi.spyOn(win, 'postMessage').mockImplementation(() => {});
}

const bunny = (event: string, value?: unknown) =>
  JSON.stringify({ context: 'player.js', version: PLAYERJS_VERSION, event, value });

function sentBunny(spy: ReturnType<typeof spyPost>) {
  return spy.mock.calls.map(([message, origin]) => {
    expect(origin).toBe(BUNNY_ORIGIN);
    return JSON.parse(String(message)) as { method: string; value?: unknown };
  });
}

function videoOf(container: HTMLElement) {
  const video = container.querySelector('video');
  if (!video) throw new Error('sem video');
  let time = 0;
  let duration = Number.NaN;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
  return {
    video,
    at(seconds: number) {
      time = seconds;
    },
    setDuration(seconds: number) {
      duration = seconds;
    },
  };
}

beforeEach(() => {
  vimeo.FakeVimeo.last = null;
  hls.FakeHls.last = null;
  hls.FakeHls.supported = true;
  FakeYouTube.last = null;
  resetYouTubeApiForTests();
  const w = window as YTWindow;
  delete w.YT;
  delete w.onYouTubeIframeAPIReady;
  for (const script of document.querySelectorAll('script')) script.remove();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------ regras puras */

describe('regras do player', () => {
  it('retoma em startAt, exceto se faltarem menos de 10 s', () => {
    expect(resumePosition(120, 600)).toBe(120);
    expect(resumePosition(595, 600)).toBe(0);
    expect(resumePosition(600 - RESUME_TAIL_SECONDS, 600)).toBe(590);
    expect(resumePosition(120, undefined)).toBe(120);
    expect(resumePosition(0, 600)).toBe(0);
    expect(resumePosition(null, 600)).toBe(0);
  });

  it('onTime no máximo a cada 15 s, e na hora ao pausar', () => {
    let now = 0;
    const emit = vi.fn();
    const reporter = createTimeReporter(emit, { now: () => now });
    for (let second = 1; second <= 40; second++) {
      now = second * 1000;
      reporter.tick(second);
    }
    expect(emit.mock.calls.map(([s]) => s)).toEqual([15, 30]);
    now = 41_000;
    reporter.flush(41.7);
    expect(emit).toHaveBeenLastCalledWith(41);
    reporter.flush(41.2);
    expect(emit).toHaveBeenCalledTimes(3);
    expect(TIME_REPORT_INTERVAL_MS).toBe(15_000);
  });

  it('não reenvia a posição já gravada', () => {
    const emit = vi.fn();
    const reporter = createTimeReporter(emit, { initial: 120 });
    reporter.flush(120.4);
    expect(emit).not.toHaveBeenCalled();
  });

  it('classifica as URLs e só monta iframe para os hosts da tabela', () => {
    expect(resolveVideoSource('youtube', 'https://youtu.be/dQw4w9WgXcQ')).toEqual({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
    });
    expect(resolveVideoSource('youtube', 'https://www.youtube.com/live/dQw4w9WgXcQ').kind).toBe(
      'youtube',
    );
    expect(resolveVideoSource('youtube', 'https://evil.example/watch?v=dQw4w9WgXcQ').kind).toBe(
      'link',
    );
    expect(resolveVideoSource('vimeo', 'https://vimeo.com/76979871/abc123')).toEqual({
      kind: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/76979871?h=abc123&dnt=1',
    });
    expect(resolveVideoSource('bunny', 'https://vz-1.b-cdn.net/abc/playlist.m3u8')).toEqual({
      kind: 'native',
      url: 'https://vz-1.b-cdn.net/abc/playlist.m3u8',
      hls: true,
    });
    expect(resolveVideoSource('bunny', 'https://example.com/playlist.m3u8').kind).toBe('link');
    expect(resolveVideoSource('file', 'https://example.com/playlist.m3u8').kind).toBe('link');
    expect(resolveVideoSource('panda', 'https://player-vz-x.evil.com.br/embed/?v=1').kind).toBe(
      'link',
    );
    expect(resolveVideoSource('file', 'https://cdn.example.com/a.webm').kind).toBe('native');
    expect(resolveVideoSource('file', 'http://cdn.example.com/a.mp4').kind).toBe('invalid');
    expect(resolveVideoSource('link', 'javascript:alert(1)').kind).toBe('invalid');
    expect(resolveVideoSource('file', 'https://user:pw@cdn.example.com/a.mp4').kind).toBe(
      'invalid',
    );
  });
});

/* ------------------------------------------------------------ YouTube */

describe('VideoPlayer: youtube', () => {
  it('carrega a IFrame API sob demanda e usa youtube-nocookie', async () => {
    const { container } = render(
      <VideoPlayer src={URLS.youtube} provider="youtube" startAt={90} labels={labels} />,
    );
    const scripts = [...document.querySelectorAll('script')].map((s) => s.src);
    expect(scripts).toEqual([YOUTUBE_API_URL]);
    const src = new URL(frame(container).src);
    expect(src.origin).toBe('https://www.youtube-nocookie.com');
    expect(src.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(src.searchParams.get('enablejsapi')).toBe('1');
    expect(src.searchParams.get('start')).toBe('90');
    expect(frame(container).title).toBe(labels.title);

    (window as YTWindow).YT = { Player: FakeYouTube };
    await act(async () => {
      (window as YTWindow).onYouTubeIframeAPIReady?.();
    });
    await flush();
    expect(FakeYouTube.last?.element).toBe(frame(container));
  });

  it('informa tempo, pausa, fim e erro, e aceita seek', async () => {
    vi.useFakeTimers();
    (window as YTWindow).YT = { Player: FakeYouTube };
    const onTime = vi.fn();
    const onEnded = vi.fn();
    const onError = vi.fn();
    const ref = createRef<VideoPlayerHandle>();
    render(
      <VideoPlayer
        ref={ref}
        src={URLS.youtube}
        provider="youtube"
        labels={labels}
        onTime={onTime}
        onEnded={onEnded}
        onError={onError}
      />,
    );
    await flush();
    const yt = FakeYouTube.last;
    if (!yt) throw new Error('player não criado');
    expect(ref.current?.getCurrentTime()).toBeNull();
    act(() => yt.options.events.onReady?.());
    act(() => yt.options.events.onStateChange?.({ data: 1 }));
    for (let s = 1; s <= 16; s++) {
      yt.time = s;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(onTime.mock.calls.map(([s]) => s)).toEqual([15]);
    yt.time = 16.4;
    expect(ref.current?.getCurrentTime()).toBe(16.4);
    yt.time = 20;
    act(() => yt.options.events.onStateChange?.({ data: 2 }));
    expect(onTime).toHaveBeenLastCalledWith(20);
    yt.time = 600;
    act(() => yt.options.events.onStateChange?.({ data: 0 }));
    expect(onEnded).toHaveBeenCalledTimes(1);
    act(() => yt.options.events.onError?.({ data: 150 }));
    expect(onError).toHaveBeenCalledWith({ provider: 'youtube', reason: 'youtube-150' });
    ref.current?.seek(42);
    expect(yt.seekTo).toHaveBeenCalledWith(42, true);
  });
});

/* ------------------------------------------------------------ Vimeo */

describe('VideoPlayer: vimeo', () => {
  it('usa o @vimeo/player empacotado e retoma com a duração real', async () => {
    const onTime = vi.fn();
    const onEnded = vi.fn();
    const onError = vi.fn();
    const ref = createRef<VideoPlayerHandle>();
    const { container, unmount } = render(
      <VideoPlayer
        ref={ref}
        src={URLS.vimeo}
        provider="vimeo"
        startAt={120}
        labels={labels}
        onTime={onTime}
        onEnded={onEnded}
        onError={onError}
      />,
    );
    await flush();
    const player = vimeo.FakeVimeo.last;
    if (!player) throw new Error('player não criado');
    expect(player.element).toBe(frame(container));
    expect(frame(container).src).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(player.setCurrentTime).toHaveBeenCalledWith(120);
    expect(ref.current?.getCurrentTime()).toBeNull();
    act(() => player.emit('timeupdate', { seconds: 125.3, duration: 600, percent: 0.2 }));
    expect(onTime).not.toHaveBeenCalled();
    expect(ref.current?.getCurrentTime()).toBe(125.3);
    act(() => player.emit('pause', { seconds: 130.5, duration: 600, percent: 0.2 }));
    expect(onTime).toHaveBeenLastCalledWith(130);
    act(() => player.emit('ended', { seconds: 600, duration: 600, percent: 1 }));
    expect(onEnded).toHaveBeenCalledTimes(1);
    act(() => player.emit('error', { name: 'PrivacyError' }));
    expect(onError).toHaveBeenCalledWith({ provider: 'vimeo', reason: 'vimeo-PrivacyError' });
    ref.current?.seek(10);
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(10);
    expect(ref.current?.getCurrentTime()).toBe(10);
    unmount();
    expect(player.destroy).toHaveBeenCalled();
  });

  it('recomeça do início se faltarem menos de 10 s', async () => {
    render(<VideoPlayer src={URLS.vimeo} provider="vimeo" startAt={595} labels={labels} />);
    await flush();
    expect(vimeo.FakeVimeo.last?.setCurrentTime).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ Bunny (player.js) */

describe('VideoPlayer: bunny por postMessage', () => {
  it('assina os eventos no ready, retoma e informa tempo e fim', () => {
    const onTime = vi.fn();
    const onEnded = vi.fn();
    const onError = vi.fn();
    const ref = createRef<VideoPlayerHandle>();
    const { container } = render(
      <VideoPlayer
        ref={ref}
        src={URLS.bunny}
        provider="bunny"
        startAt={60}
        labels={labels}
        onTime={onTime}
        onEnded={onEnded}
        onError={onError}
      />,
    );
    const iframe = frame(container);
    expect(iframe.src).toBe(URLS.bunny);
    const post = spyPost(iframe);
    fromFrame(
      iframe,
      bunny('ready', { src: URLS.bunny, methods: ['getDuration'], events: [] }),
      BUNNY_ORIGIN,
    );
    const sent = sentBunny(post);
    expect(sent.filter((m) => m.method === 'addEventListener').map((m) => m.value)).toEqual([
      'timeupdate',
      'pause',
      'ended',
      'error',
    ]);
    expect(sent.at(-1)).toMatchObject({ method: 'getDuration', context: 'player.js' });
    fromFrame(iframe, bunny('getDuration', 300), BUNNY_ORIGIN);
    expect(sentBunny(post).at(-1)).toMatchObject({ method: 'setCurrentTime', value: 60 });

    expect(ref.current?.getCurrentTime()).toBeNull();
    fromFrame(iframe, bunny('timeupdate', { seconds: 75.2, duration: 300 }), BUNNY_ORIGIN);
    expect(onTime).not.toHaveBeenCalled();
    expect(ref.current?.getCurrentTime()).toBe(75.2);
    fromFrame(iframe, bunny('pause'), BUNNY_ORIGIN);
    expect(onTime).toHaveBeenLastCalledWith(75);
    fromFrame(iframe, bunny('ended'), BUNNY_ORIGIN);
    expect(onEnded).toHaveBeenCalledTimes(1);

    fromFrame(iframe, bunny('error', { code: 5, msg: 'play blocked' }), BUNNY_ORIGIN);
    expect(onError).not.toHaveBeenCalled();
    fromFrame(iframe, bunny('error'), BUNNY_ORIGIN);
    expect(onError).toHaveBeenCalledWith({ provider: 'bunny', reason: 'bunny-media' });

    ref.current?.seek(12);
    expect(sentBunny(post).at(-1)).toMatchObject({ method: 'setCurrentTime', value: 12 });
    expect(ref.current?.getCurrentTime()).toBe(12);
  });

  it('ignora mensagens de outra origem ou de outra janela', () => {
    const onEnded = vi.fn();
    const { container } = render(
      <VideoPlayer src={URLS.bunny} provider="bunny" labels={labels} onEnded={onEnded} />,
    );
    const iframe = frame(container);
    fromFrame(iframe, bunny('ended'), 'https://evil.example');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: bunny('ended'), origin: BUNNY_ORIGIN, source: window }),
      );
    });
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('.m3u8 da b-cdn toca no <video> com hls.js', async () => {
    const onError = vi.fn();
    const { container } = render(
      <VideoPlayer
        src="https://vz-1.b-cdn.net/abc/playlist.m3u8"
        provider="bunny"
        labels={labels}
        onError={onError}
      />,
    );
    await flush();
    const instance = hls.FakeHls.last;
    expect(instance?.loadSource).toHaveBeenCalledWith('https://vz-1.b-cdn.net/abc/playlist.m3u8');
    expect(instance?.attachMedia).toHaveBeenCalledWith(container.querySelector('video'));
    act(() =>
      instance?.handlers.get('hlsError')?.('hlsError', { fatal: true, type: 'networkError' }),
    );
    expect(onError).toHaveBeenCalledWith({ provider: 'bunny', reason: 'hls-networkError' });
  });
});

/* ------------------------------------------------------------ Panda */

describe('VideoPlayer: panda por postMessage', () => {
  it('retoma no panda_ready e informa tempo, pausa, fim e erro', () => {
    const onTime = vi.fn();
    const onEnded = vi.fn();
    const onError = vi.fn();
    const ref = createRef<VideoPlayerHandle>();
    const { container } = render(
      <VideoPlayer
        ref={ref}
        src={URLS.panda}
        provider="panda"
        startAt={30}
        duration={600}
        labels={labels}
        onTime={onTime}
        onEnded={onEnded}
        onError={onError}
      />,
    );
    const iframe = frame(container);
    const post = spyPost(iframe);
    fromFrame(iframe, { message: 'panda_ready' }, PANDA_ORIGIN);
    expect(post).toHaveBeenLastCalledWith({ type: 'currentTime', parameter: 30 }, PANDA_ORIGIN);
    expect(ref.current?.getCurrentTime()).toBeNull();
    fromFrame(iframe, { message: 'panda_timeupdate', currentTime: 44.9, video: 'x' }, PANDA_ORIGIN);
    expect(onTime).not.toHaveBeenCalled();
    expect(ref.current?.getCurrentTime()).toBe(44.9);
    fromFrame(iframe, { message: 'panda_pause', currentTime: 45.1 }, PANDA_ORIGIN);
    expect(onTime).toHaveBeenLastCalledWith(45);
    expect(ref.current?.getCurrentTime()).toBe(45.1);
    fromFrame(iframe, { message: 'panda_ended', currentTime: 600 }, PANDA_ORIGIN);
    expect(onEnded).toHaveBeenCalledTimes(1);
    fromFrame(iframe, { message: 'panda_error' }, PANDA_ORIGIN);
    expect(onError).toHaveBeenCalledWith({ provider: 'panda', reason: 'panda-media' });
    ref.current?.seek(5);
    expect(post).toHaveBeenLastCalledWith({ type: 'currentTime', parameter: 5 }, PANDA_ORIGIN);
    expect(ref.current?.getCurrentTime()).toBe(5);
  });

  it('não retoma quando faltam menos de 10 s pela duração do autor', () => {
    const { container } = render(
      <VideoPlayer
        src={URLS.panda}
        provider="panda"
        startAt={595}
        duration={600}
        labels={labels}
      />,
    );
    const iframe = frame(container);
    const post = spyPost(iframe);
    fromFrame(iframe, { message: 'panda_ready' }, PANDA_ORIGIN);
    expect(post).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ vídeo nativo */

describe('VideoPlayer: file', () => {
  it('<video> dispara timeupdate e ended, retoma e tem os controles da spec', async () => {
    vi.useFakeTimers();
    const onTime = vi.fn();
    const onEnded = vi.fn();
    const { container } = render(
      <VideoPlayer
        src={URLS.file}
        provider="file"
        startAt={50}
        labels={labels}
        onTime={onTime}
        onEnded={onEnded}
      />,
    );
    const media = videoOf(container);
    expect(media.video.getAttribute('src')).toBe(URLS.file);
    expect(media.video.getAttribute('aria-label')).toBe(labels.title);
    media.setDuration(300);
    fireEvent.loadedMetadata(media.video);
    expect(media.video.currentTime).toBe(50);

    for (let s = 51; s <= 70; s++) {
      vi.advanceTimersByTime(1000);
      media.at(s);
      fireEvent.timeUpdate(media.video);
    }
    expect(onTime.mock.calls.map(([s]) => s)).toEqual([65]);

    fireEvent.click(screen.getByRole('button', { name: labels.rewind }));
    expect(media.video.currentTime).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: labels.forward }));
    expect(media.video.currentTime).toBe(70);

    const speed = screen.getByRole('combobox', { name: labels.speed }) as HTMLSelectElement;
    expect([...speed.options].map((o) => o.textContent)).toEqual([
      '0,5×',
      '0,75×',
      '1×',
      '1,25×',
      '1,5×',
      '1,75×',
      '2×',
    ]);
    fireEvent.change(speed, { target: { value: '1.5' } });
    expect(media.video.playbackRate).toBe(1.5);
    fireEvent.change(screen.getByRole('slider', { name: labels.volume }), {
      target: { value: '0.4' },
    });
    expect(media.video.volume).toBeCloseTo(0.4);

    media.at(300);
    fireEvent.ended(media.video);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onTime).toHaveBeenLastCalledWith(300);
  });

  it('getCurrentTime lê o currentTime do <video>, sem esperar o onTime', () => {
    const onTime = vi.fn();
    const ref = createRef<VideoPlayerHandle>();
    const { container } = render(
      <VideoPlayer ref={ref} src={URLS.file} provider="file" labels={labels} onTime={onTime} />,
    );
    const media = videoOf(container);
    expect(ref.current?.getCurrentTime()).toBe(0);
    media.at(7.5);
    fireEvent.timeUpdate(media.video);
    expect(onTime).not.toHaveBeenCalled();
    expect(ref.current?.getCurrentTime()).toBe(7.5);
    media.at(9.25);
    expect(ref.current?.getCurrentTime()).toBe(9.25);
    ref.current?.seek(40);
    expect(ref.current?.getCurrentTime()).toBe(40);
  });

  it('mostra tela cheia e imagem sobre imagem quando o navegador permite', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
    try {
      render(<VideoPlayer src={URLS.file} provider="file" labels={labels} />);
      expect(screen.getByRole('button', { name: labels.fullscreen })).toBeTruthy();
      expect(screen.getByRole('button', { name: labels.pictureInPicture })).toBeTruthy();
    } finally {
      delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled;
      delete (document as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;
    }
  });

  it('erro do <video> chama onError e a posição sai ao desmontar', () => {
    const onError = vi.fn();
    const onTime = vi.fn();
    const { container, unmount } = render(
      <VideoPlayer
        src={URLS.file}
        provider="file"
        labels={labels}
        onError={onError}
        onTime={onTime}
      />,
    );
    const media = videoOf(container);
    fireEvent.error(media.video);
    expect(onError).toHaveBeenCalledWith({ provider: 'file', reason: 'media' });
    media.at(33);
    fireEvent.timeUpdate(media.video);
    expect(onTime).not.toHaveBeenCalled();
    unmount();
    expect(onTime).toHaveBeenCalledWith(33);
  });
});

/* ------------------------------------------------------------ link e critérios gerais */

describe('VideoPlayer: link', () => {
  it('mostra "Abrir vídeo" em nova aba e passa no axe', async () => {
    const onEnded = vi.fn();
    const { container } = render(
      <VideoPlayer
        src="https://example.com/aula"
        provider="link"
        labels={labels}
        onEnded={onEnded}
      />,
    );
    const link = screen.getByRole('link', { name: /Abrir vídeo/ });
    expect(link.getAttribute('href')).toBe('https://example.com/aula');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('iframe, video')).toBeNull();
    await expectNoAxeViolations(container);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('getCurrentTime devolve null no link', () => {
    const ref = createRef<VideoPlayerHandle>();
    render(
      <VideoPlayer ref={ref} src="https://example.com/aula" provider="link" labels={labels} />,
    );
    expect(ref.current?.getCurrentTime()).toBeNull();
  });

  it('URL insegura não vira link e chama onError', () => {
    const onError = vi.fn();
    const { container } = render(
      <VideoPlayer src="javascript:alert(1)" provider="link" labels={labels} onError={onError} />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(onError).toHaveBeenCalledWith({ provider: 'link', reason: 'invalid-url' });
  });

  it('só a aula do YouTube carrega script externo', async () => {
    for (const provider of ['vimeo', 'bunny', 'panda', 'file'] as const) {
      const { unmount } = render(
        <VideoPlayer src={URLS[provider]} provider={provider} labels={labels} />,
      );
      await flush();
      unmount();
    }
    render(<VideoPlayer src="https://example.com/x" provider="link" labels={labels} />);
    expect(document.querySelectorAll('script[src]')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ mapa de atividade */

const heatmapLabels: ActivityHeatmapLabels = {
  title: 'Atividade nos últimos 12 meses',
  day: (date, total) => `${total} atividade(s) em ${date}`,
  summary: (total, active) => `${total} atividades em ${active} dias`,
  less: 'Menos',
  more: 'Mais',
};

describe('ActivityHeatmap', () => {
  it('monta 53 semanas × 7 dias terminando na semana de hoje', () => {
    const grid = buildActivityGrid([], '2026-11-25'); // quarta-feira
    expect(grid).toHaveLength(53);
    for (const week of grid) expect(week).toHaveLength(7);
    expect(grid[0]?.[0]?.date).toBe('2025-11-23'); // domingo, 52 semanas antes do domingo desta semana
    const last = grid[52] ?? [];
    expect(last[3]).toMatchObject({ date: '2026-11-25', future: false });
    expect(last[4]).toMatchObject({ date: '2026-11-26', future: true });
  });

  it('5 intensidades em quartos do maior total', () => {
    expect([0, 1, 2, 3, 4, 8].map((total) => activityLevel(total, 8))).toEqual([0, 1, 1, 2, 2, 4]);
    expect(activityLevel(6, 8)).toBe(3);
    expect(activityLevel(3, 0)).toBe(0);
  });

  it('desenha os dias com rótulo acessível, resumo e sem violação no axe', async () => {
    const days = [
      { day: '2026-11-25', total: 4 },
      { day: '2026-11-24', total: 1 },
      { day: '2026-03-01', total: 2 },
      { day: '2024-01-01', total: 9 }, // fora do período
    ];
    const { container } = render(
      <ActivityHeatmap days={days} today="2026-11-25" labels={heatmapLabels} />,
    );
    const table = screen.getByRole('table', { name: heatmapLabels.title });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(table.querySelectorAll('td[data-level]')).toHaveLength(52 * 7 + 4);
    expect(container.querySelector('td[data-date="2026-11-25"]')?.getAttribute('data-level')).toBe(
      '4',
    );
    expect(container.querySelector('td[data-date="2026-11-24"]')?.getAttribute('data-level')).toBe(
      '1',
    );
    expect(screen.getByText('4 atividade(s) em 25 de novembro de 2026')).toBeTruthy();
    const summary = screen.getByText('7 atividades em 3 dias');
    expect(table.getAttribute('aria-describedby')).toBe(summary.id);
    expect(container.querySelectorAll('.minui-heatmap__swatch')).toHaveLength(5);
    await expectNoAxeViolations(container);
  });

  it('o dia não muda com o fuso do navegador', () => {
    const { container } = render(
      <ActivityHeatmap
        days={[{ day: '2026-01-01', total: 1 }]}
        today="2026-01-01"
        labels={heatmapLabels}
        locale="pt-BR"
      />,
    );
    expect(screen.getByText('1 atividade(s) em 1 de janeiro de 2026')).toBeTruthy();
    expect(container.querySelector('td[data-date="2026-01-01"]')?.getAttribute('data-level')).toBe(
      '4',
    );
  });
});
