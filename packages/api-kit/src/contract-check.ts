import { type Contract, type ContractOperation, CSRF_SCHEME, toContractPath } from './contract.ts';

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
  /**
   * `false` faz qualquer operação com `x-nuva-pending` (com ou sem rota) virar divergência: é o
   * `check-contract --no-pending` do `verify:full` e da release (spec 003). Padrão: `true`.
   */
  allowPending?: boolean;
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
  /**
   * Operações que não declaram todas as respostas de erro da tabela "Respostas de erro
   * declaradas" da spec 003, com os status que faltam: `GET /api/v1/users/{id}: 404, 429`.
   */
  missingErrorResponses: string[];
  /**
   * Aviso, não divergência: operações com `x-nuva-pending: true` ainda sem rota
   * (`MÉTODO /caminho`). Não entram em `ok`.
   */
  pendingOperations: string[];
  /**
   * Aviso, não divergência: operações com `x-nuva-pending: true` que já têm rota; a marca pode
   * sair do contrato. Não entram em `ok`.
   */
  pendingWithRoute: string[];
  /**
   * Divergência: todas as operações pendentes, quando a conferência foi feita com
   * `allowPending: false`. Vazia no modo padrão.
   */
  pendingNotAllowed: string[];
  /** Verdadeiro quando as listas de divergência estão vazias (avisos não contam). */
  ok: boolean;
}

/** `/metrics` é a única rota fora do contrato nas duas APIs. */
export const DEFAULT_INTERNAL_ROUTES: readonly string[] = ['GET /metrics'];

/** Prefixo das operações de negócio; fora dele ficam as sondas (`/healthz`, `/readyz`). */
export const API_PREFIX = '/api/v1';

/**
 * Status de erro que a operação precisa declarar (spec 003, "Respostas de erro declaradas"):
 *
 * | Operação | Declara |
 * | --- | --- |
 * | Toda operação de `/api/v1` | `400`, `429`, `500`, `503` |
 * | Com sessão (`security` não vazio) | também `401` e `403` |
 * | Com corpo de requisição | também `413` e `415` |
 * | Com parâmetro de caminho | também `404` |
 * | Fora de `/api/v1` (sondas) | nada: só as próprias |
 *
 * `409` e `422` não entram: são declarados só onde a spec do recurso define um código.
 */
export function requiredErrorResponses(operation: ContractOperation): string[] {
  if (operation.path !== API_PREFIX && !operation.path.startsWith(`${API_PREFIX}/`)) {
    return [];
  }
  const required = ['400', '429', '500', '503'];
  if (operation.security.length > 0) {
    required.push('401', '403');
  }
  if (operation.requestBody !== null) {
    required.push('413', '415');
  }
  if (operation.path.includes('{') || operation.parameters.some((param) => param.in === 'path')) {
    required.push('404');
  }
  return required.sort();
}

/**
 * Operações que deixam de declarar alguma resposta de erro exigida, uma linha por operação:
 * `GET /api/v1/users/{id}: 404, 429`. O status precisa estar escrito na operação: faixa (`4XX`)
 * e `default` não contam, porque o cliente gerado tipa cada status declarado. Vale também para
 * operação pendente.
 */
export function findMissingErrorResponses(contract: Contract): string[] {
  const missing: string[] = [];
  for (const operation of contract.operations) {
    const declared = new Set(operation.responses.map((response) => response.status));
    const absent = requiredErrorResponses(operation).filter((status) => !declared.has(status));
    if (absent.length > 0) {
      missing.push(`${operation.key}: ${absent.join(', ')}`);
    }
  }
  return missing.sort();
}

/** Rota do Fastify na forma usada na comparação: `GET /api/v1/users/{id}`. */
export function routeKey(route: RegisteredRoute): string {
  return `${route.method.toUpperCase()} ${toContractPath(route.path)}`;
}

/**
 * Compara rotas e contrato nos dois sentidos (spec 003, RF-04), confere a regra do CSRF e as
 * respostas de erro que cada operação precisa declarar.
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
  const pending = new Set(
    contract.operations.filter((operation) => operation.pending).map((operation) => operation.key),
  );
  // Operação pendente (`x-nuva-pending`): o contrato veio antes; a falta da rota é só aviso.
  const operationsMissingInApp = [...declared]
    .filter((key) => !registered.has(key) && !pending.has(key))
    .sort();
  const pendingOperations = [...pending].filter((key) => !registered.has(key)).sort();
  const pendingWithRoute = [...pending].filter((key) => registered.has(key)).sort();
  const pendingNotAllowed = options.allowPending === false ? [...pending].sort() : [];

  const exceptions = new Set(options.csrfExceptions ?? []);
  const withoutCsrf = new Set(findWritesWithoutCsrf(contract));
  const writesWithoutCsrf = [...withoutCsrf].filter((id) => !exceptions.has(id)).sort();
  const staleCsrfExceptions = [...exceptions].filter((id) => !withoutCsrf.has(id)).sort();
  const missingErrorResponses = findMissingErrorResponses(contract);

  return {
    routesMissingInContract,
    operationsMissingInApp,
    writesWithoutCsrf,
    staleCsrfExceptions,
    missingErrorResponses,
    pendingOperations,
    pendingWithRoute,
    pendingNotAllowed,
    ok:
      routesMissingInContract.length === 0 &&
      operationsMissingInApp.length === 0 &&
      writesWithoutCsrf.length === 0 &&
      staleCsrfExceptions.length === 0 &&
      missingErrorResponses.length === 0 &&
      pendingNotAllowed.length === 0,
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

export interface FormatContractReportOptions {
  /**
   * Acrescenta os avisos (operações pendentes), cada linha começando por `aviso:`. Padrão:
   * `false`, para o texto continuar vazio quando não há divergência.
   */
  warnings?: boolean;
}

/**
 * Texto das divergências, uma por linha; vazio quando não há nenhuma. Com `warnings: true`,
 * lista também as operações pendentes (`x-nuva-pending`), que não são divergência.
 */
export function formatContractReport(
  report: ContractReport,
  options: FormatContractReportOptions = {},
): string {
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
  add('resposta de erro não declarada', report.missingErrorResponses);
  add('operação ainda marcada com x-nuva-pending', report.pendingNotAllowed);
  if (options.warnings) {
    lines.push(...formatContractWarnings(report));
  }
  return lines.join('\n');
}

/** Avisos do relatório, um por item, cada um começando por `aviso:`; vazio quando não há. */
export function formatContractWarnings(report: ContractReport): string[] {
  return [
    ...report.pendingOperations.map(
      (item) => `aviso: operação pendente (x-nuva-pending) ainda sem rota: ${item}`,
    ),
    ...report.pendingWithRoute.map(
      (item) => `aviso: operação pendente (x-nuva-pending) já tem rota; remova a marca: ${item}`,
    ),
  ];
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
