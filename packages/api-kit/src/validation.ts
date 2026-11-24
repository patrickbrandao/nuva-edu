import type { FieldError } from '@nuva-edu/core';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { FORM_MEDIA_TYPE, MULTIPART_MEDIA_TYPE, UploadedFile } from './bodies.ts';
import {
  type Contract,
  ContractError,
  type ContractOperation,
  type JsonSchema,
} from './contract.ts';

// O pacote é CommonJS: sob NodeNext o `default` pode vir embrulhado.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;

/** Nome sob o qual o documento do contrato fica registrado no Ajv. */
const DOCUMENT_ID = 'nuva-contract';

export interface RequestParts {
  params: unknown;
  query: unknown;
  headers: unknown;
  body: unknown;
  /** Valor do cabeçalho `Content-Type` da requisição, se houver. */
  contentType: string | undefined;
}

export type ResponseCheck =
  | { ok: true }
  | {
      ok: false;
      /** `undeclared_status`, `undeclared_media_type` ou `schema_mismatch`. */
      reason: 'undeclared_status' | 'undeclared_media_type' | 'schema_mismatch';
      /** Descrição para o log; não contém os valores da resposta. */
      detail: string;
    };

export interface OperationValidator {
  /**
   * Confere a requisição contra a operação. Converte, no próprio objeto, parâmetros de caminho,
   * consulta e cabeçalho para o tipo do contrato e aplica os valores padrão.
   * @returns os campos recusados; vazio quando a requisição está no contrato.
   */
  validateRequest(parts: RequestParts): FieldError[];
  /**
   * Diz se a operação aceita um corpo com este `Content-Type`. Sem corpo e sem cabeçalho, ou em
   * operação que não declara corpo, é sempre verdadeiro. Falso vira `415` na base HTTP.
   */
  acceptsContentType(contentType: string | undefined, body: unknown): boolean;
  /** Confere status, tipo de mídia e corpo de uma resposta. */
  validateResponse(status: number, contentType: string | undefined, body: unknown): ResponseCheck;
  /** Diz se o contrato declara o status (exato, faixa `4XX` ou `default`). */
  declaresStatus(status: number): boolean;
}

/** Confere um valor contra um esquema; devolve os campos recusados (vazio: confere). */
export type SchemaValidator = (value: unknown, prefix?: string) => FieldError[];

export interface ContractValidator {
  for(operation: ContractOperation): OperationValidator;
  /**
   * Validador de um esquema avulso de `components.schemas` (por exemplo `StreamEvent`), com os
   * tipos exatos, sem conversão. Lança `ContractError` se o esquema não existir.
   * O `prefix` (padrão: o nome do esquema) abre o `path` de cada campo recusado.
   */
  schema(name: string): SchemaValidator;
}

/**
 * Compila os esquemas do contrato (JSON Schema 2020-12, o dialeto do OpenAPI 3.1). Esquema
 * inválido ou formato desconhecido falha aqui, na subida do serviço, e não na primeira requisição.
 */
export function createContractValidator(contract: Contract): ContractValidator {
  const failOnWarning = {
    log: () => {},
    warn: (...args: unknown[]) => {
      throw new ContractError(`${contract.source}: ${args.map(String).join(' ')}`);
    },
    error: (...args: unknown[]) => {
      throw new ContractError(`${contract.source}: ${args.map(String).join(' ')}`);
    },
  };
  const options = {
    // O contrato usa palavras do OpenAPI que não são de JSON Schema (`example`, `x-*`).
    strict: false,
    allErrors: true,
    validateFormats: true,
    logger: failOnWarning,
  } as const;
  // Corpo e respostas: tipos exatos, sem conversão.
  const exact = new Ajv2020(options);
  // Caminho, consulta e cabeçalho chegam como texto: convertem para o tipo do contrato.
  const coercing = new Ajv2020({ ...options, coerceTypes: 'array', useDefaults: true });
  for (const ajv of [exact, coercing]) {
    addFormats(ajv);
    ajv.addSchema(contract.document, DOCUMENT_ID, undefined, false);
  }

  const compile = (ajv: Ajv2020, schema: JsonSchema, where: string): ValidateFunction => {
    try {
      return ajv.compile(qualifyRefs(schema) as JsonSchema);
    } catch (error) {
      if (error instanceof ContractError) {
        throw error;
      }
      throw new ContractError(
        `${contract.source} ${where}: esquema inválido: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const cache = new Map<string, OperationValidator>();
  const schemas = new Map<string, SchemaValidator>();
  return {
    schema(name) {
      let validator = schemas.get(name);
      if (!validator) {
        const components = (contract.document.components ?? {}) as { schemas?: unknown };
        const declared = (components.schemas ?? {}) as Record<string, unknown>;
        if (!Object.hasOwn(declared, name)) {
          throw new ContractError(`${contract.source}: não existe o esquema "${name}".`);
        }
        const pointer = name.replace(/~/g, '~0').replace(/\//g, '~1');
        const validate = compile(
          exact,
          { $ref: `#/components/schemas/${pointer}` },
          `esquema ${name}`,
        );
        validator = (value, prefix = name) =>
          validate(value) ? [] : toFieldErrors(validate.errors, prefix);
        schemas.set(name, validator);
      }
      return validator;
    },

    for(operation) {
      let validator = cache.get(operation.operationId);
      if (!validator) {
        validator = buildOperationValidator(operation, contract.document, {
          exact: (schema, where) => compile(exact, schema, `${operation.key} ${where}`),
          coercing: (schema, where) => compile(coercing, schema, `${operation.key} ${where}`),
        });
        cache.set(operation.operationId, validator);
      }
      return validator;
    },
  };
}

interface Compilers {
  exact(schema: JsonSchema, where: string): ValidateFunction;
  coercing(schema: JsonSchema, where: string): ValidateFunction;
}

function buildOperationValidator(
  operation: ContractOperation,
  document: Record<string, unknown>,
  compilers: Compilers,
): OperationValidator {
  const group = (location: 'path' | 'query' | 'header'): ValidateFunction | null => {
    const params = operation.parameters.filter((param) => param.in === location);
    if (params.length === 0) {
      return null;
    }
    // O Node entrega os nomes de cabeçalho em minúsculas.
    const name = (raw: string) => (location === 'header' ? raw.toLowerCase() : raw);
    return compilers.coercing(
      {
        type: 'object',
        properties: Object.fromEntries(params.map((param) => [name(param.name), param.schema])),
        required: params.filter((param) => param.required).map((param) => name(param.name)),
      },
      `parâmetros (${location})`,
    );
  };
  const params = group('path');
  const query = group('query');
  const headers = group('header');

  const bodies = new Map<string, ValidateFunction | null>();
  // Propriedades do corpo multipart que são arquivo (`format: binary`); as outras são texto.
  let multipartFiles = new Set<string>();
  for (const [mediaType, schema] of Object.entries(operation.requestBody?.content ?? {})) {
    bodies.set(
      mediaType,
      schema !== null && hasReadableBody(mediaType)
        ? compilers.exact(schema, `corpo (${mediaType})`)
        : null,
    );
    if (mediaType === MULTIPART_MEDIA_TYPE && schema !== null) {
      multipartFiles = fileProperties(document, schema);
    }
  }

  const responses = operation.responses.map((response) => ({
    response,
    content: new Map(
      Object.entries(response.content).map(([mediaType, schema]) => [
        mediaType,
        schema !== null && isJsonMediaType(mediaType)
          ? compilers.exact(schema, `resposta ${response.status} (${mediaType})`)
          : null,
      ]),
    ),
  }));
  const responseFor = (status: number) =>
    responses.find((entry) => entry.response.status === String(status)) ??
    responses.find(
      (entry) => entry.response.status.toUpperCase() === `${Math.floor(status / 100)}XX`,
    ) ??
    responses.find((entry) => entry.response.status === 'default');

  return {
    validateRequest(parts) {
      const errors: FieldError[] = [];
      const run = (validate: ValidateFunction | null, data: unknown, prefix: string) => {
        if (validate && !validate(data ?? {})) {
          errors.push(...toFieldErrors(validate.errors, prefix));
        }
      };
      run(params, parts.params, 'path');
      run(query, parts.query, 'query');
      run(headers, parts.headers, 'header');

      const body = operation.requestBody;
      if (body) {
        const absent = parts.body === undefined || parts.body === null;
        if (absent && !hasContentType(parts.contentType)) {
          if (body.required) {
            errors.push({ path: 'body', message: 'O corpo da requisição é obrigatório.' });
          }
        } else {
          const mediaType = pickMediaType(bodies, parts.contentType);
          if (mediaType === undefined) {
            errors.push({
              path: 'body',
              message: `Tipo de conteúdo não aceito. Use ${[...bodies.keys()].join(' ou ')}.`,
            });
          } else {
            const validate = bodies.get(mediaType) ?? null;
            let data = parts.body;
            if (mediaType === MULTIPART_MEDIA_TYPE) {
              const view = multipartView(parts.body, multipartFiles);
              errors.push(...view.errors);
              data = view.data;
            }
            if (validate && !validate(data)) {
              errors.push(...toFieldErrors(validate.errors, 'body'));
            }
          }
        }
      }
      return errors;
    },

    acceptsContentType(contentType, body) {
      if (!operation.requestBody) {
        return true;
      }
      const absent = body === undefined || body === null;
      if (absent && !hasContentType(contentType)) {
        return true;
      }
      return pickMediaType(bodies, contentType) !== undefined;
    },

    validateResponse(status, contentType, body) {
      const entry = responseFor(status);
      if (!entry) {
        return {
          ok: false,
          reason: 'undeclared_status',
          detail: `${operation.key}: o contrato não declara resposta ${status}.`,
        };
      }
      if (entry.content.size === 0) {
        return body === undefined || body === null
          ? { ok: true }
          : {
              ok: false,
              reason: 'undeclared_media_type',
              detail: `${operation.key}: a resposta ${status} não tem corpo no contrato.`,
            };
      }
      const mediaType = pickMediaType(entry.content, contentType ?? 'application/json');
      if (mediaType === undefined) {
        return {
          ok: false,
          reason: 'undeclared_media_type',
          detail: `${operation.key}: a resposta ${status} não declara o tipo ${contentType ?? 'application/json'}.`,
        };
      }
      const validate = entry.content.get(mediaType) ?? null;
      if (validate && !validate(body)) {
        return {
          ok: false,
          reason: 'schema_mismatch',
          detail: `${operation.key}: resposta ${status} fora do contrato: ${describeErrors(validate.errors)}`,
        };
      }
      return { ok: true };
    },

    declaresStatus(status) {
      return responseFor(status) !== undefined;
    },
  };
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

/** Corpos que a base lê e entrega como objeto, validados pelo esquema do contrato. */
function hasReadableBody(mediaType: string): boolean {
  return (
    isJsonMediaType(mediaType) ||
    mediaType === FORM_MEDIA_TYPE ||
    mediaType === MULTIPART_MEDIA_TYPE
  );
}

/**
 * O corpo multipart como o esquema o enxerga: cada arquivo vira texto vazio (o esquema o
 * descreve como `type: string, format: binary`). Arquivo em propriedade de texto, ou texto em
 * propriedade de arquivo, é recusado aqui, porque o esquema não distingue os dois.
 */
function multipartView(
  body: unknown,
  files: ReadonlySet<string>,
): { data: unknown; errors: FieldError[] } {
  if (typeof body !== 'object' || body === null) {
    return { data: body, errors: [] };
  }
  const errors: FieldError[] = [];
  const data: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(body)) {
    const isFile = value instanceof UploadedFile;
    if (isFile && !files.has(name)) {
      errors.push({ path: `body.${name}`, message: 'Deve ser texto, não arquivo.' });
    } else if (!isFile && files.has(name)) {
      errors.push({ path: `body.${name}`, message: 'Deve ser um arquivo.' });
    }
    Object.defineProperty(data, name, {
      value: isFile ? '' : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { data, errors };
}

/**
 * Nomes das propriedades de arquivo de um esquema de corpo multipart: as que têm
 * `format: binary` (ou `contentMediaType`/`contentEncoding`, do OpenAPI 3.1). Segue `$ref`
 * internos e os ramos de `allOf`.
 */
function fileProperties(document: Record<string, unknown>, schema: JsonSchema): Set<string> {
  const names = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    const node = resolveRef(document, value);
    if (!isObject(node) || depth > 10) {
      return;
    }
    if (isObject(node.properties)) {
      for (const [name, property] of Object.entries(node.properties)) {
        const resolved = resolveRef(document, property);
        if (
          isObject(resolved) &&
          (resolved.format === 'binary' ||
            resolved.contentMediaType !== undefined ||
            resolved.contentEncoding !== undefined)
        ) {
          names.add(name);
        }
      }
    }
    if (Array.isArray(node.allOf)) {
      for (const member of node.allOf) {
        visit(member, depth + 1);
      }
    }
  };
  visit(schema, 0);
  return names;
}

function resolveRef(document: Record<string, unknown>, value: unknown): unknown {
  let current = value;
  for (let hops = 0; isObject(current) && typeof current.$ref === 'string' && hops < 20; hops++) {
    const ref = current.$ref;
    if (!ref.startsWith('#/')) {
      return undefined;
    }
    let target: unknown = document;
    for (const segment of ref.slice(2).split('/')) {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      target = isObject(target) ? target[key] : undefined;
    }
    current = target;
  }
  return current;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasContentType(contentType: string | undefined): boolean {
  return contentType !== undefined && contentType.trim() !== '';
}

/** Escolhe a entrada de `content` que atende o `Content-Type`: exata, por tipo (`text/` mais asterisco) ou o curinga total. */
function pickMediaType(
  content: ReadonlyMap<string, unknown>,
  contentType: string | undefined,
): string | undefined {
  const essence = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (content.has(essence)) {
    return essence;
  }
  const wildcard = `${essence.split('/')[0]}/*`;
  if (content.has(wildcard)) {
    return wildcard;
  }
  return content.has('*/*') ? '*/*' : undefined;
}

/** `#/components/...` → `nuva-contract#/components/...`, para o esquema valer fora do documento. */
function qualifyRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(qualifyRefs);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] =
      key === '$ref' && typeof entry === 'string' && entry.startsWith('#')
        ? `${DOCUMENT_ID}${entry}`
        : qualifyRefs(entry);
  }
  return result;
}

/** `/items/0/name` → `prefixo.items[0].name`. */
function toPath(prefix: string, instancePath: string, extra?: string): string {
  let path = prefix;
  const segments = instancePath.split('/').slice(1);
  if (extra !== undefined) {
    segments.push(extra);
  }
  for (const raw of segments) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    path += /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`;
  }
  return path;
}

const MESSAGES: Record<string, (params: Record<string, unknown>) => string> = {
  required: () => 'Campo obrigatório.',
  additionalProperties: () => 'Campo não aceito.',
  unevaluatedProperties: () => 'Campo não aceito.',
  type: (params) => `Deve ser do tipo ${String(params.type)}.`,
  enum: (params) =>
    `Deve ser um destes valores: ${(params.allowedValues as unknown[]).join(', ')}.`,
  const: (params) => `Deve ser igual a ${JSON.stringify(params.allowedValue)}.`,
  format: (params) => `Formato inválido (esperado: ${String(params.format)}).`,
  pattern: () => 'Formato inválido.',
  minLength: (params) => `Deve ter no mínimo ${String(params.limit)} caracteres.`,
  maxLength: (params) => `Deve ter no máximo ${String(params.limit)} caracteres.`,
  minimum: (params) => `Deve ser maior ou igual a ${String(params.limit)}.`,
  maximum: (params) => `Deve ser menor ou igual a ${String(params.limit)}.`,
  exclusiveMinimum: (params) => `Deve ser maior que ${String(params.limit)}.`,
  exclusiveMaximum: (params) => `Deve ser menor que ${String(params.limit)}.`,
  multipleOf: (params) => `Deve ser múltiplo de ${String(params.multipleOf)}.`,
  minItems: (params) => `Deve ter no mínimo ${String(params.limit)} itens.`,
  maxItems: (params) => `Deve ter no máximo ${String(params.limit)} itens.`,
  uniqueItems: () => 'Não pode ter itens repetidos.',
  minProperties: (params) => `Deve ter no mínimo ${String(params.limit)} campos.`,
  maxProperties: (params) => `Deve ter no máximo ${String(params.limit)} campos.`,
};

/** Palavras que só resumem a falha de um ramo; o erro útil é o do ramo. */
const COMPOSITE = new Set(['oneOf', 'anyOf', 'allOf', 'if', 'not']);

/**
 * Erros do Ajv como `errors[]` do problem+json. As mensagens nunca repetem o valor recebido:
 * um campo recusado pode ser uma senha.
 */
export function toFieldErrors(
  errors: readonly ErrorObject[] | null | undefined,
  prefix: string,
): FieldError[] {
  const list = errors ?? [];
  const useful = list.filter((error) => !COMPOSITE.has(error.keyword));
  const seen = new Set<string>();
  const result: FieldError[] = [];
  for (const error of useful.length > 0 ? useful : list) {
    const params = error.params as Record<string, unknown>;
    const extra =
      error.keyword === 'required'
        ? String(params.missingProperty)
        : error.keyword === 'additionalProperties'
          ? String(params.additionalProperty)
          : error.keyword === 'unevaluatedProperties'
            ? String(params.unevaluatedProperty)
            : undefined;
    const field: FieldError = {
      path: toPath(prefix, error.instancePath, extra),
      message: MESSAGES[error.keyword]?.(params) ?? 'Valor inválido.',
    };
    const key = `${field.path}\n${field.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(field);
    }
  }
  return result;
}

/** Resumo para o log: caminho e regra violada, sem o valor. */
function describeErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 10)
    .map((error) => {
      const params = error.params as Record<string, unknown>;
      const name = params.missingProperty ?? params.additionalProperty;
      const suffix = name === undefined ? '' : ` (${String(name)})`;
      return `${error.instancePath || '/'} ${error.keyword}${suffix}`;
    })
    .join('; ');
}
