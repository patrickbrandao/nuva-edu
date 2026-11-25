import { useEffect, useRef } from 'react';
import { type AdapterProps, createEmbedFrame } from './adapter';
import { resumePosition } from './time';

/*
 * Vimeo pelo `@vimeo/player` (ADR 0025), empacotado no site e importado sob demanda (fica num
 * pedaço próprio do bundle, sem script externo). A biblioteca embrulha o `iframe` que montamos
 * e traz os eventos `timeupdate`, `pause`, `ended` e `error` com `{ seconds, duration }`.
 */

export function VimeoAdapter({
  embedUrl,
  startAt,
  durationHint,
  title,
  events,
  control,
}: AdapterProps & { embedUrl: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initial = useRef({ startAt, durationHint, title });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { startAt: at, durationHint: hint, title: name } = initial.current;
    const iframe = createEmbedFrame(embedUrl, name);
    host.appendChild(iframe);
    let disposed = false;
    let player: import('@vimeo/player').default | null = null;

    import('@vimeo/player')
      .then(({ default: Player }) => {
        if (disposed) return;
        const vimeo = new Player(iframe);
        player = vimeo;
        vimeo.on('timeupdate', (data) => events.time(data.seconds));
        vimeo.on('pause', (data) => events.pause(data.seconds));
        vimeo.on('ended', (data) => {
          events.pause(data.seconds);
          events.ended();
        });
        vimeo.on('error', (error) => events.error(`vimeo-${error?.name ?? 'error'}`));
        control.current = {
          seek: (seconds) => {
            vimeo.setCurrentTime(seconds).catch(() => {});
          },
        };
        return vimeo
          .ready()
          .then(() => vimeo.getDuration())
          .then((duration) => {
            const position = resumePosition(at, duration || hint);
            if (!disposed && position > 0) return vimeo.setCurrentTime(position);
            return undefined;
          });
      })
      .catch(() => {
        if (!disposed) events.error('vimeo-load');
      });

    return () => {
      disposed = true;
      control.current = null;
      const current = player;
      if (current) {
        current
          .destroy()
          .catch(() => {})
          .finally(() => iframe.remove());
      } else {
        iframe.remove();
      }
    };
  }, [embedUrl, events, control]);

  return <div ref={hostRef} className="minui-video__embed" />;
}
