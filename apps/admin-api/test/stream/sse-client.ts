/** Um evento SSE lido do fio. `comment` marca as linhas `: ...`, que o navegador ignora. */
export interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

export interface SseConnection {
  status: number;
  headers: Headers;
  /** Próximo evento (comentários ficam de fora); rejeita se passar do prazo ou o fluxo acabar. */
  next(timeoutMs?: number): Promise<SseFrame>;
  /** Resolve quando o servidor encerra o fluxo; rejeita se passar do prazo. */
  ended(timeoutMs?: number): Promise<void>;
  /** Tudo o que chegou até agora, inclusive comentários. */
  frames: SseFrame[];
  close(): void;
}

/** Cliente HTTP de verdade (o `fetch` do Node) lendo `text/event-stream` aos poucos. */
export async function openSse(
  url: string,
  headers: Record<string, string> = {},
): Promise<SseConnection> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const frames: SseFrame[] = [];
  let delivered = 0;
  let finished = false;
  let wake: () => void = () => {};
  const changed = (): Promise<void> =>
    new Promise((resolve) => {
      wake = resolve;
    });

  const pump = async (): Promise<void> => {
    const reader = response.body?.getReader();
    if (!reader) {
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        frames.push(parseFrame(buffer.slice(0, end)));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
      }
      wake();
    }
  };
  void pump()
    .catch(() => {})
    .finally(() => {
      finished = true;
      wake();
    });

  const waitFor = async <T>(timeoutMs: number, what: string, check: () => T | undefined) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = check();
      if (found !== undefined) {
        return found;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(`${what}: nada em ${timeoutMs} ms.`);
      }
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        changed(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, left);
        }),
      ]);
      clearTimeout(timer);
    }
  };

  return {
    status: response.status,
    headers: response.headers,
    frames,
    next: (timeoutMs = 2_000) =>
      waitFor(timeoutMs, 'Evento SSE', () => {
        while (delivered < frames.length) {
          const frame = frames[delivered];
          delivered += 1;
          if (frame && frame.comment === undefined) {
            return frame;
          }
        }
        if (finished) {
          throw new Error('O fluxo SSE terminou antes do evento esperado.');
        }
        return undefined;
      }),
    ended: async (timeoutMs = 2_000) => {
      await waitFor(timeoutMs, 'Fim do fluxo SSE', () => (finished ? true : undefined));
    },
    close: () => controller.abort(),
  };
}

function parseFrame(text: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of text.split('\n')) {
    if (line.startsWith(':')) {
      frame.comment = line.slice(1).trim();
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id' || field === 'event' || field === 'data') {
      frame[field] = value;
    }
  }
  return frame;
}
