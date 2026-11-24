// Limite de processamentos simultâneos por processo (spec 029, "Fluxo de envio"): 2 ao mesmo
// tempo e fila interna de 10; acima disso, `503` `image_processing_busy` com `Retry-After`.

import { imageProcessingBusy } from './rules.ts';

export interface ImageProcessingLimiterOptions {
  /** Processamentos ao mesmo tempo. Padrão: 2. */
  concurrency?: number;
  /** Envios esperando a vez. Padrão: 10. */
  maxQueue?: number;
  /** Valor do `Retry-After` quando a fila está cheia. Padrão: 5 s. */
  retryAfterSeconds?: number;
}

export interface ImageProcessingLimiter {
  /** Roda a tarefa quando houver vaga; com a fila cheia, lança `image_processing_busy`. */
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly queued: number;
}

export const IMAGE_PROCESSING_CONCURRENCY = 2;
export const IMAGE_PROCESSING_MAX_QUEUE = 10;
export const IMAGE_PROCESSING_RETRY_AFTER_SECONDS = 5;

export function createImageProcessingLimiter(
  options: ImageProcessingLimiterOptions = {},
): ImageProcessingLimiter {
  const concurrency = options.concurrency ?? IMAGE_PROCESSING_CONCURRENCY;
  const maxQueue = options.maxQueue ?? IMAGE_PROCESSING_MAX_QUEUE;
  const retryAfterSeconds = options.retryAfterSeconds ?? IMAGE_PROCESSING_RETRY_AFTER_SECONDS;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('createImageProcessingLimiter: concurrency precisa ser inteiro >= 1.');
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new TypeError('createImageProcessingLimiter: maxQueue precisa ser inteiro >= 0.');
  }
  let active = 0;
  const waiting: Array<() => void> = [];

  function release(): void {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      active -= 1;
    }
  }

  return {
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < concurrency) {
        active += 1;
      } else if (waiting.length < maxQueue) {
        // A vaga passa direto de quem termina para quem espera (`active` não muda).
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        throw imageProcessingBusy(retryAfterSeconds);
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

/** Limitador do processo, usado por `uploadImage` quando quem chama não passa outro. */
export const imageProcessingLimiter: ImageProcessingLimiter = createImageProcessingLimiter();
