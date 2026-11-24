import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Métodos de leitura: não alteram dados e não exigem `csrfToken` (spec 003, "CSRF no contrato"). */
export const READ_METHODS: readonly HttpMethod[] = ['get', 'head', 'options', 'trace'];

/** Nome do esquema de segurança que representa o cabeçalho `X-CSRF-Token` nos contratos. */
export const CSRF_SCHEME = 'csrfToken';

/** Extensão que marca uma operação cuja rota ainda não existe. */
export const PENDING_EXTENSION = 'x-nuva-pending';

export type JsonSchema = Record<string, unknown> | boolean;

/** Uma alternativa do `security`: todos os esquemas dela são exigidos juntos. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export interface ContractParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: JsonSchema;
}

export interface ContractResponse {
  /** `"200"`, `"404"`, `"default"`, `"4XX"`... como escrito no contrato. */
  status: string;
  /** Esquema por tipo de mídia; vazio quando a resposta não tem corpo. */
  content: Readonly<Record<string, JsonSchema | null>>;
}

export interface ContractOperation {
  operationId: string;
  method: HttpMethod;
  /** Caminho como no contrato: `/api/v1/users/{id}`. */
  path: string;
  /** Caminho no formato do Fastify: `/api/v1/users/:id`. */
  routePath: string;
  /** `GET /api/v1/users/{id}`: a chave usada na comparação com as rotas registradas. */
  key: string;
  /** Alternativas de segurança já resolvidas (da operação ou o padrão do contrato). Vazio: pública. */
  security: readonly SecurityRequirement[];
  /** Verdadeiro quando o método altera dados (não é `GET`, `HEAD`, `OPTIONS` nem `TRACE`). */
  isWrite: boolean;
  /**
   * Verdadeiro quando a operação leva `x-nuva-pending: true`: o contrato chegou antes da rota.
   * A conferência de contrato não exige a rota de uma operação pendente.
   */
  pending: boolean;
  parameters: readonly ContractParameter[];
  /** Esquema do corpo por tipo de mídia; `null` quando a operação não tem corpo. */
  requestBody: {
    required: boolean;
    content: Readonly<Record<string, JsonSchema | null>>;
  } | null;
  responses: readonly ContractResponse[];
}

export interface Contract {
  /** Arquivo de origem, para as mensagens de erro. */
  source: string;
  /** O documento OpenAPI inteiro, com as referências internas preservadas. */
  document: Record<string, unknown>;
  operations: readonly ContractOperation[];
  securitySchemes: readonly string[];
  /** Operação pelo `operationId`; lança se não existir. */
  operation(operationId: string): ContractOperation;
  /** Operação pelo método e caminho do contrato (`/users/{id}`), ou `undefined`. */
  find(method: string, path: string): ContractOperation | undefined;
}

/** O contrato não pôde ser lido ou está fora do que a base HTTP sabe aplicar. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

/** Lê e interpreta um `openapi.yaml` (OpenAPI 3.1). */
export function loadContract(file: string | URL): Contract {
  const path = typeof file === 'string' ? file : fileURLToPath(file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ContractError(
      `Não consegui ler o contrato em ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseContract(parse(text), path);
}

/** Interpreta um documento OpenAPI já carregado. `source` aparece nas mensagens de erro. */
export function parseContract(document: unknown, source = 'openapi'): Contract {
  if (!isRecord(document) || typeof document.openapi !== 'string') {
    throw new ContractError(`${source}: não é um documento OpenAPI.`);
  }
  if (!document.openapi.startsWith('3.1')) {
    throw new ContractError(`${source}: só OpenAPI 3.1 é aceito (veio ${document.openapi}).`);
  }
  const resolve = <T>(value: T): T => deref(document, value, source);
  const defaultSecurity = readSecurity(document.security, source) ?? [];
  const components = isRecord(document.components) ? document.components : {};
  const securitySchemes = Object.keys(
    isRecord(components.securitySchemes) ? components.securitySchemes : {},
  );

  const operations: ContractOperation[] = [];
  const byId = new Map<string, ContractOperation>();
  const paths = isRecord(document.paths) ? document.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = resolve(rawItem);
    if (!isRecord(item)) {
      continue;
    }
    const shared = readParameters(item.parameters, resolve, `${source} ${path}`);
    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (!isRecord(raw)) {
        continue;
      }
      const key = `${method.toUpperCase()} ${path}`;
      const where = `${source} ${key}`;
      if (typeof raw.operationId !== 'string' || raw.operationId === '') {
        throw new ContractError(`${where}: falta o operationId.`);
      }
      if (byId.has(raw.operationId)) {
        throw new ContractError(`${where}: operationId "${raw.operationId}" repetido.`);
      }
      const security = readSecurity(raw.security, where) ?? defaultSecurity;
      for (const requirement of security) {
        for (const scheme of Object.keys(requirement)) {
          if (!securitySchemes.includes(scheme)) {
            throw new ContractError(`${where}: esquema de segurança "${scheme}" não declarado.`);
          }
        }
      }
      const own = readParameters(raw.parameters, resolve, where);
      const parameters = [
        ...shared.filter(
          (param) => !own.some((other) => other.name === param.name && other.in === param.in),
        ),
        ...own,
      ];
      const operation: ContractOperation = {
        operationId: raw.operationId,
        method,
        path,
        routePath: toRoutePath(path),
        key,
        security,
        isWrite: !READ_METHODS.includes(method),
        pending: readPending(raw[PENDING_EXTENSION], where),
        parameters,
        requestBody: readRequestBody(raw.requestBody, resolve),
        responses: readResponses(raw.responses, resolve, where),
      };
      operations.push(operation);
      byId.set(operation.operationId, operation);
    }
  }

  return {
    source,
    document,
    operations,
    securitySchemes,
    operation(operationId) {
      const found = byId.get(operationId);
      if (!found) {
        throw new ContractError(`${source}: não existe operação "${operationId}" no contrato.`);
      }
      return found;
    },
    find(method, path) {
      const wanted = `${method.toUpperCase()} ${path}`;
      return operations.find((operation) => operation.key === wanted);
    },
  };
}

/** `/users/{id}/badges` → `/users/:id/badges`. */
export function toRoutePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

/** `/users/:id/badges` → `/users/{id}/badges`. */
export function toContractPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Segue `$ref` internos de objetos de componente (parâmetro, resposta, corpo); não toca em esquemas. */
function deref<T>(document: Record<string, unknown>, value: T, source: string): T {
  let current: unknown = value;
  for (let hops = 0; isRecord(current) && typeof current.$ref === 'string'; hops += 1) {
    const ref = current.$ref;
    if (!ref.startsWith('#/') || hops > 20) {
      throw new ContractError(`${source}: referência não suportada ou circular: ${ref}`);
    }
    let target: unknown = document;
    for (const segment of ref.slice(2).split('/')) {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      target = isRecord(target) ? target[key] : undefined;
    }
    if (target === undefined) {
      throw new ContractError(`${source}: referência sem destino: ${ref}`);
    }
    current = target;
  }
  return current as T;
}

function readPending(value: unknown, where: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new ContractError(`${where}: "${PENDING_EXTENSION}" deve ser true ou false.`);
  }
  return value;
}

function readSecurity(value: unknown, where: string): SecurityRequirement[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new ContractError(`${where}: "security" deve ser uma lista de objetos.`);
  }
  // `security: [{}]` (alternativa vazia) quer dizer "sem exigência", como a lista vazia.
  return (value as Record<string, unknown>[])
    .filter((requirement) => Object.keys(requirement).length > 0)
    .map((requirement) =>
      Object.fromEntries(
        Object.entries(requirement).map(([scheme, scopes]) => [
          scheme,
          Array.isArray(scopes) ? scopes.map(String) : [],
        ]),
      ),
    );
}

function readParameters(
  value: unknown,
  resolve: <T>(value: T) => T,
  where: string,
): ContractParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const param = resolve(entry) as unknown;
    if (
      !isRecord(param) ||
      typeof param.name !== 'string' ||
      !['path', 'query', 'header', 'cookie'].includes(param.in as string)
    ) {
      throw new ContractError(`${where}: parâmetro inválido.`);
    }
    return {
      name: param.name,
      in: param.in as ContractParameter['in'],
      required: param.in === 'path' ? true : param.required === true,
      schema: (param.schema as JsonSchema | undefined) ?? true,
    };
  });
}

function readContent(value: unknown): Record<string, JsonSchema | null> {
  const content: Record<string, JsonSchema | null> = {};
  if (isRecord(value)) {
    for (const [mediaType, media] of Object.entries(value)) {
      content[mediaType.toLowerCase()] =
        isRecord(media) && media.schema !== undefined ? (media.schema as JsonSchema) : null;
    }
  }
  return content;
}

function readRequestBody(
  value: unknown,
  resolve: <T>(value: T) => T,
): ContractOperation['requestBody'] {
  const body = resolve(value) as unknown;
  if (!isRecord(body)) {
    return null;
  }
  return { required: body.required === true, content: readContent(body.content) };
}

function readResponses(
  value: unknown,
  resolve: <T>(value: T) => T,
  where: string,
): ContractResponse[] {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new ContractError(`${where}: a operação não declara respostas.`);
  }
  return Object.entries(value).map(([status, entry]) => {
    const response = resolve(entry) as unknown;
    return { status, content: readContent(isRecord(response) ? response.content : undefined) };
  });
}
