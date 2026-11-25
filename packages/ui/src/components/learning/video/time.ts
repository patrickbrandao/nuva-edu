/*
 * Posição do vídeo (spec 014): enviada no máximo a cada 15 s (RNF-04), mais ao pausar, ao
 * terminar e ao sair da página; ao reabrir, retoma na posição gravada, exceto se faltarem
 * menos de 10 s para o fim.
 */

/** Intervalo mínimo entre dois `onTime` durante a reprodução. */
export const TIME_REPORT_INTERVAL_MS = 15_000;
/** Com menos que isto até o fim, a aula recomeça do início. */
export const RESUME_TAIL_SECONDS = 10;

/** Posição em que o vídeo começa: `startAt`, ou 0 se faltar pouco para o fim ou não houver posição. */
export function resumePosition(startAt?: number | null, duration?: number | null): number {
  if (startAt == null || !Number.isFinite(startAt) || startAt <= 0) return 0;
  if (
    duration != null &&
    Number.isFinite(duration) &&
    duration > 0 &&
    duration - startAt < RESUME_TAIL_SECONDS
  ) {
    return 0;
  }
  return startAt;
}

export interface TimeReporter {
  /** Tempo durante a reprodução: só vira `onTime` se já passaram 15 s do último envio. */
  tick(seconds: number): void;
  /** Pausa, fim ou saída da página: envia já a última posição conhecida, se mudou. */
  flush(seconds?: number): void;
}

export interface TimeReporterOptions {
  intervalMs?: number;
  now?: () => number;
  /** Posição já gravada (o `startAt`): não é reenviada. */
  initial?: number | undefined;
}

/** Acumula as posições que o player informa e decide quando chamar `emit` (segundos inteiros). */
export function createTimeReporter(
  emit: (seconds: number) => void,
  { intervalMs = TIME_REPORT_INTERVAL_MS, now = Date.now, initial }: TimeReporterOptions = {},
): TimeReporter {
  let lastAt = now();
  let lastSent = initial != null && Number.isFinite(initial) ? Math.floor(initial) : undefined;
  let latest: number | undefined;

  const send = () => {
    if (latest === undefined || latest === lastSent) return;
    lastSent = latest;
    lastAt = now();
    emit(latest);
  };
  const remember = (seconds: number | undefined) => {
    if (seconds != null && Number.isFinite(seconds) && seconds >= 0) latest = Math.floor(seconds);
  };

  return {
    tick(seconds) {
      remember(seconds);
      if (now() - lastAt >= intervalMs) send();
    },
    flush(seconds) {
      remember(seconds);
      send();
    },
  };
}
