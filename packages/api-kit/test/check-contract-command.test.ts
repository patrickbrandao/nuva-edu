import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  CHECK_CONTRACT_EXIT,
  type Contract,
  parseContract,
  runCheckContract,
} from '../src/index.ts';
import { buildApp, fixtureContract } from './helpers.ts';

const CSRF_EXCEPTIONS = ['deleteItem', 'login'];

/** O contrato de teste com as operações de `/api/v1/items/{id}` marcadas como pendentes. */
function pendingContract(): Contract {
  const document = structuredClone(fixtureContract().document) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  for (const method of ['get', 'delete']) {
    const operation = document.paths['/api/v1/items/{id}']?.[method];
    if (operation) {
      operation['x-nuva-pending'] = true;
    }
  }
  return parseContract(document, 'pendente.yaml');
}

type OperationId = 'listItems' | 'createItem' | 'getItem' | 'deleteItem' | 'login';

/** App com as operações pedidas; `closed` diz se o comando o encerrou. */
function appWith(operations: readonly OperationId[], contract?: Contract) {
  const state = { closed: false };
  const build = (): FastifyInstance => {
    const { app } = buildApp({
      ...(contract ? { contract } : {}),
      security: { sessionCookie: () => {}, csrfToken: () => {}, apiKey: () => {} },
    });
    for (const operation of operations) {
      app.operation(operation, () => ({}));
    }
    app.addHook('onClose', async () => {
      state.closed = true;
    });
    return app;
  };
  return { build, state };
}

const ALL: readonly OperationId[] = ['listItems', 'createItem', 'getItem', 'deleteItem', 'login'];
const WITHOUT_PENDING: readonly OperationId[] = ['listItems', 'createItem', 'login'];

async function run(
  argv: string[],
  build: () => FastifyInstance | Promise<FastifyInstance>,
  csrfExceptions: readonly string[] = CSRF_EXCEPTIONS,
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCheckContract({
    service: 'teste-api',
    build,
    csrfExceptions,
    argv,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

describe('check-contract', () => {
  it('sai com 0 quando rotas e contrato conferem, e encerra o app', async () => {
    const { build, state } = appWith(ALL);
    const result = await run([], build);
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.ok);
    expect(result.err).toEqual([]);
    expect(result.out).toHaveLength(1);
    expect(result.out[0]).toMatch(/^check-contract teste-api: contrato e rotas conferem \(7 /);
    expect(state.closed).toBe(true);
  });

  it('sai com 1 e lista cada divergência', async () => {
    const { build, state } = appWith(['listItems', 'createItem', 'getItem', 'login']);
    const result = await run([], build, []);
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.mismatch);
    expect(result.out).toEqual([]);
    expect(result.err[0]).toMatch(/^check-contract teste-api: 3 divergência\(s\)/);
    expect(result.err.slice(1)).toEqual([
      '  operação do contrato sem rota: DELETE /api/v1/items/{id}',
      '  escrita sem csrfToken no security: deleteItem',
      '  escrita sem csrfToken no security: login',
    ]);
    expect(state.closed).toBe(true);
  });

  it('sem --no-pending, operação pendente só gera aviso, com ou sem rota', async () => {
    const withoutRoute = await run([], appWith(WITHOUT_PENDING, pendingContract()).build);
    expect(withoutRoute.code).toBe(CHECK_CONTRACT_EXIT.ok);
    expect(withoutRoute.out).toHaveLength(1);
    expect(withoutRoute.err).toEqual([
      'check-contract teste-api: aviso: operação pendente (x-nuva-pending) ainda sem rota: DELETE /api/v1/items/{id}',
      'check-contract teste-api: aviso: operação pendente (x-nuva-pending) ainda sem rota: GET /api/v1/items/{id}',
    ]);

    const withRoute = await run([], appWith(ALL, pendingContract()).build);
    expect(withRoute.code).toBe(CHECK_CONTRACT_EXIT.ok);
    expect(withRoute.err).toEqual([
      'check-contract teste-api: aviso: operação pendente (x-nuva-pending) já tem rota; remova a marca: DELETE /api/v1/items/{id}',
      'check-contract teste-api: aviso: operação pendente (x-nuva-pending) já tem rota; remova a marca: GET /api/v1/items/{id}',
    ]);
  });

  it('com --no-pending, falha listando as operações pendentes, com ou sem rota', async () => {
    // Uma pendente com rota (`getItem`) e outra sem (`deleteItem`).
    const { build } = appWith([...WITHOUT_PENDING, 'getItem'], pendingContract());
    const result = await run(['--no-pending'], build);
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.mismatch);
    expect(result.out).toEqual([]);
    expect(result.err[0]).toMatch(/^check-contract teste-api: 2 divergência\(s\) \(7 .*pendente/);
    expect(result.err.slice(1, 3)).toEqual([
      '  operação ainda marcada com x-nuva-pending: DELETE /api/v1/items/{id}',
      '  operação ainda marcada com x-nuva-pending: GET /api/v1/items/{id}',
    ]);
    expect(result.err[3]).toContain('--no-pending recusa operação pendente');
    expect(result.err).toHaveLength(4);
  });

  it('com --no-pending e contrato sem pendente, sai com 0', async () => {
    // O `--` é o separador que o `pnpm run` repassa.
    const result = await run(['--', '--no-pending'], appWith(ALL).build);
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.ok);
    expect(result.out[0]).toContain('nenhuma pendente');
  });

  it('opção desconhecida sai com 2, sem montar o app', async () => {
    let built = false;
    const result = await run(['--sem-pendentes'], () => {
      built = true;
      return appWith(ALL).build();
    });
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.usage);
    expect(result.err[0]).toBe('check-contract teste-api: opção desconhecida: --sem-pendentes');
    expect(built).toBe(false);
  });

  it('--help mostra o uso e sai com 0', async () => {
    const result = await run(['--help'], appWith(ALL).build);
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.ok);
    expect(result.out[0]).toBe('Uso: check-contract [--no-pending]');
  });

  it('app que não monta sai com 1 e diz o motivo', async () => {
    const result = await run([], () => {
      const { app } = buildApp();
      app.operation('naoExiste', () => ({}));
      return app;
    });
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.mismatch);
    expect(result.err.join('\n')).toContain('não existe operação "naoExiste" no contrato');
  });
});
