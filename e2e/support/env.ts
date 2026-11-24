// Endereços e opções do e2e, lidos do ambiente (padrões de docs/ambiente-local.md).
import { resolve } from 'node:path';

function baseUrl(name: string, fallback: string): string {
  return (process.env[name] ?? fallback).replace(/\/+$/, '');
}

/** Raiz do repositório: é de lá que saem `pnpm dev:up` e `pnpm compose`. */
export const ROOT_DIR = resolve(import.meta.dirname, '..', '..');

/** Site admin; `/api/` e `/healthz` desse host vão para a admin-api. */
export const ADMIN_URL = baseUrl('NUVA_E2E_ADMIN_URL', 'http://edu-admin.localhost:8080');

/** Site do aluno; `/api/` e `/healthz` desse host vão para a classroom-api. */
export const CLASSROOM_URL = baseUrl('NUVA_E2E_CLASSROOM_URL', 'http://classroom.localhost:8080');

/**
 * `NUVA_E2E_COMPOSE=0` diz que o ambiente não é o Compose desta máquina: o e2e não tenta subi-lo
 * e pula o que depende de `docker compose exec` (a saúde do worker).
 */
export const USES_LOCAL_COMPOSE = process.env.NUVA_E2E_COMPOSE !== '0';

/** Comando que sobe o ambiente local, citado nas mensagens de erro. */
export const UP_COMMAND = 'pnpm dev:up';
