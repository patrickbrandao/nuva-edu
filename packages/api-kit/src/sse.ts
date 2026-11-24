import type { Readable } from 'node:stream';

/** Tipo de mídia de um fluxo SSE (Server-Sent Events). */
export const SSE_CONTENT_TYPE = 'text/event-stream';

/**
 * Cabeçalhos de toda resposta SSE: sem cache e sem o proxy segurar a resposta para juntar ou
 * comprimir (`X-Accel-Buffering` é lido pelo nginx e afins).
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': SSE_CONTENT_TYPE,
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
};

export interface SseEvent {
  /** Campo `id`: o navegador o devolve em `Last-Event-ID` ao reconectar. */
  id?: string | number;
  /** Campo `event`: o nome do evento. Sem ele o navegador entrega como `message`. */
  event?: string;
  /** Campo `data`: sempre escrito como JSON numa linha só. Ausente: `{}`. */
  data?: unknown;
  /** Campo `retry`: espera, em ms, antes de o navegador reconectar. */
  retry?: number;
}

const LINE_BREAK = /[\r\n]/;

/**
 * Um evento no fio: `id`, `event`, `retry` e `data`, nesta ordem, fechado por linha em branco.
 * O `JSON.stringify` escapa quebras de linha, então `data` nunca ocupa mais de uma linha.
 */
export function formatSseEvent(event: SseEvent): string {
  let frame = '';
  if (event.id !== undefined) {
    frame += `id: ${singleLine(String(event.id), 'id')}\n`;
  }
  if (event.event !== undefined) {
    frame += `event: ${singleLine(event.event, 'event')}\n`;
  }
  if (event.retry !== undefined) {
    if (!Number.isInteger(event.retry) || event.retry < 0) {
      throw new TypeError('O campo "retry" do evento SSE deve ser um inteiro não negativo.');
    }
    frame += `retry: ${event.retry}\n`;
  }
  return `${frame}data: ${JSON.stringify(event.data ?? {})}\n\n`;
}

/**
 * Comentário SSE: o cliente ignora. Enviado ao abrir o fluxo, faz os cabeçalhos saírem já.
 */
export function formatSseComment(text = 'ok'): string {
  return `: ${singleLine(text, 'comentário')}\n\n`;
}

function singleLine(value: string, field: string): string {
  if (LINE_BREAK.test(value)) {
    throw new TypeError(`O campo "${field}" do evento SSE não pode ter quebra de linha.`);
  }
  return value;
}

/** Os fluxos SSE abertos neste processo (`app.eventStreams`). */
export interface EventStreams {
  /** Conexões abertas agora: é o valor do medidor `sse_connections`. */
  count(): number;
  /**
   * Encerra todos os fluxos: o cliente vê o fim da resposta e reconecta sozinho. A base chama
   * no `preClose`, para os fluxos não segurarem o encerramento do serviço.
   */
  closeAll(): void;
}

export interface EventStreamTracker extends EventStreams {
  /** Passa a contar o fluxo até ele fechar (evento `close`). */
  track(stream: Readable): void;
}

/** Conjunto dos fluxos abertos, sem depender do Fastify. */
export function createEventStreamTracker(): EventStreamTracker {
  const open = new Set<Readable>();
  return {
    track(stream) {
      if (stream.destroyed || open.has(stream)) {
        return;
      }
      open.add(stream);
      stream.once('close', () => open.delete(stream));
    },
    count: () => open.size,
    closeAll() {
      for (const stream of [...open]) {
        open.delete(stream);
        const end = (stream as { end?: unknown }).end;
        if (typeof end === 'function') {
          // Duplex/PassThrough: termina do jeito normal, e o que já foi escrito ainda sai.
          end.call(stream);
        } else {
          stream.destroy();
        }
      }
    },
  };
}
