// Ritmo das operações de autenticação feitas pelo navegador. Todas chegam às APIs com o mesmo IP
// (o do gateway do Docker, atrás do Traefik local), e a classroom-api aceita 10 por minuto por IP
// em login, cadastro, início do login social e redefinição de senha (spec 004, RNF-04); a
// admin-api, 20 (spec 003, RNF-03). Antes de cada clique que dispara uma delas, o teste pede uma
// vaga aqui. A conta é compartilhada pelos processos do Playwright num arquivo em `tmp/`, com
// trava por diretório, e vale também entre execuções seguidas.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT_DIR } from './env.ts';

/** Abaixo dos limites reais, com folga para o que não passa por aqui. */
const BUDGET = { classroom: 8, admin: 16 } as const;
const WINDOW_MS = 62_000;
const DIR = resolve(ROOT_DIR, 'tmp', 'playwright', 'pacing');

export type Site = keyof typeof BUDGET;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const lock = resolve(DIR, `${name}.lock`);
  await mkdir(DIR, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch {
      // Trava esquecida por um processo que morreu: depois de 10 s, vale tomar.
      if (Date.now() - start > 10_000) {
        await rm(lock, { recursive: true, force: true });
      }
      await sleep(25);
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/** Espera até caberem `cost` operações de autenticação no site e as registra. */
export async function pace(site: Site, cost = 1): Promise<void> {
  const file = resolve(DIR, `${site}.json`);
  for (;;) {
    const wait = await withLock(site, async () => {
      const now = Date.now();
      let stamps: number[] = [];
      try {
        stamps = JSON.parse(await readFile(file, 'utf8')) as number[];
      } catch {
        stamps = [];
      }
      stamps = stamps.filter((stamp) => stamp > now - WINDOW_MS).sort((a, b) => a - b);
      if (stamps.length + cost <= BUDGET[site]) {
        await writeFile(file, JSON.stringify([...stamps, ...Array(cost).fill(now)]));
        return 0;
      }
      const freeing = stamps[stamps.length + cost - BUDGET[site] - 1] ?? now;
      return Math.max(50, freeing + WINDOW_MS - now);
    });
    if (wait === 0) {
      return;
    }
    await sleep(wait);
  }
}
