import { type Contract, CSRF_SCHEME, toContractPath } from './contract.ts';

/** Uma rota registrada no Fastify. */
export interface RegisteredRoute {
  /** `GET`, `POST`... */
  method: string;
  /** Caminho no formato do Fastify: `/api/v1/users/:id`. */
  path: string;
}

export interface ContractCheckOptions {
  /**
   * Rotas que ficam fora do contrato de propósito, como `GET /metrics` (spec 003, RF-04).
   * Formato: `MÉTODO /caminho`, com o caminho como no contrato.
   */
  internalRoutes?: readonly string[];
  /**
   * `operationId` das operações de escrita que não exigem `csrfToken`. Cada exceção diz o motivo
   * na descrição da operação no contrato (spec 003, "CSRF no contrato").
   */
  csrfExceptions?: readonly string[];
}

export interface ContractReport {
  /** Rotas registradas que o contrato não descreve (`MÉTODO /caminho`). */
  routesMissingInContract: string[];
  /** Operações do contrato sem rota registrada (`MÉTODO /caminho`). */
  operationsMissingInApp: string[];
  /** Operações de escrita sem `csrfToken` no `security` e fora das exceções (`operationId`). */
  writesWithoutCsrf: string[];
  /** Exceções que não existem mais ou que já declaram `csrfToken`: a lista precisa ser limpa. */
  staleCsrfExceptions: string[];
  /** Verdadeiro quando as quatro listas estão vazias. */
  ok: boolean;
}

/** `/metrics` é a única rota fora do contrato nas duas APIs. */
export const DEFAULT_INTERNAL_ROUTES: readonly string[] = ['GET /metrics'];

/** Rota do Fastify na forma usada na comparação: `GET /api/v1/users/{id}`. */
export function routeKey(route: RegisteredRoute): string {
  return `${route.method.toUpperCase()} ${toContractPath(route.path)}`;
}

/**
 * Compara rotas e contrato nos dois sentidos (spec 003, RF-04) e confere a regra do CSRF.
 * Não lança: devolve as divergências para o teste de contrato mostrar todas de uma vez.
 */
export function checkContract(
  contract: Contract,
  routes: readonly RegisteredRoute[],
  options: ContractCheckOptions = {},
): ContractReport {
  const internal = new Set(options.internalRoutes ?? DEFAULT_INTERNAL_ROUTES);
  const registered = new Set(routes.map(routeKey));
  const declared = new Set(contract.operations.map((operation) => operation.key));

  const routesMissingInContract = [...registered]
    .filter((key) => !declared.has(key) && !internal.has(key))
    .sort();
  const operationsMissingInApp = [...declared].filter((key) => !registered.has(key)).sort();

  const exceptions = new Set(options.csrfExceptions ?? []);
  const withoutCsrf = new Set(findWritesWithoutCsrf(contract));
  const writesWithoutCsrf = [...withoutCsrf].filter((id) => !exceptions.has(id)).sort();
  const staleCsrfExceptions = [...exceptions].filter((id) => !withoutCsrf.has(id)).sort();

  return {
    routesMissingInContract,
    operationsMissingInApp,
    writesWithoutCsrf,
    staleCsrfExceptions,
    ok:
      routesMissingInContract.length === 0 &&
      operationsMissingInApp.length === 0 &&
      writesWithoutCsrf.length === 0 &&
      staleCsrfExceptions.length === 0,
  };
}

/**
 * `operationId` das operações de escrita em que alguma alternativa do `security` dispensa o
 * `csrfToken` (inclusive as públicas, com `security: []`).
 */
export function findWritesWithoutCsrf(contract: Contract): string[] {
  return contract.operations
    .filter(
      (operation) =>
        operation.isWrite &&
        (operation.security.length === 0 ||
          operation.security.some((requirement) => !(CSRF_SCHEME in requirement))),
    )
    .map((operation) => operation.operationId);
}

/** Texto das divergências, uma por linha; vazio quando não há nenhuma. */
export function formatContractReport(report: ContractReport): string {
  const lines: string[] = [];
  const add = (title: string, items: readonly string[]) => {
    for (const item of items) {
      lines.push(`${title}: ${item}`);
    }
  };
  add('rota registrada fora do contrato', report.routesMissingInContract);
  add('operação do contrato sem rota', report.operationsMissingInApp);
  add('escrita sem csrfToken no security', report.writesWithoutCsrf);
  add('exceção de CSRF que não se aplica mais', report.staleCsrfExceptions);
  return lines.join('\n');
}

/** Contrato e serviço divergem: o serviço não sobe (spec 003, "Casos de erro"). */
export class ContractMismatchError extends Error {
  readonly report: ContractReport;

  constructor(source: string, report: ContractReport) {
    super(`Contrato e rotas divergem (${source}):\n${formatContractReport(report)}`);
    this.name = 'ContractMismatchError';
    this.report = report;
  }
}
