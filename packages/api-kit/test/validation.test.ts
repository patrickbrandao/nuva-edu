import { describe, expect, it } from 'vitest';
import {
  ContractError,
  createContractValidator,
  parseContract,
  type RequestParts,
} from '../src/index.ts';
import { fixtureContract } from './helpers.ts';

const contract = fixtureContract();
const validator = createContractValidator(contract);
const check = (operationId: string) => validator.for(contract.operation(operationId));

function parts(overrides: Partial<RequestParts> = {}): RequestParts {
  return {
    params: {},
    query: {},
    headers: {},
    body: undefined,
    contentType: undefined,
    ...overrides,
  };
}

describe('validação da requisição', () => {
  it('converte parâmetros de texto para o tipo do contrato e aplica o padrão', () => {
    const query: Record<string, unknown> = { tag: 'a' };
    const headers: Record<string, unknown> = { 'x-trace-level': '2' };
    expect(check('listItems').validateRequest(parts({ query, headers }))).toEqual([]);
    expect(query).toEqual({ limit: 25, tag: ['a'] });
    expect(headers['x-trace-level']).toBe(2);

    const params: Record<string, unknown> = { id: '7' };
    expect(check('getItem').validateRequest(parts({ params }))).toEqual([]);
    expect(params.id).toBe(7);
  });

  it('aponta o campo recusado em caminho, consulta e cabeçalho', () => {
    expect(check('getItem').validateRequest(parts({ params: { id: 'abc' } }))).toEqual([
      { path: 'path.id', message: 'Deve ser do tipo integer.' },
    ]);
    expect(
      check('listItems').validateRequest(
        parts({ query: { limit: '500' }, headers: { 'x-trace-level': '-1' } }),
      ),
    ).toEqual([
      { path: 'query.limit', message: 'Deve ser menor ou igual a 100.' },
      { path: 'header.x-trace-level', message: 'Deve ser maior ou igual a 0.' },
    ]);
  });

  it('aceita parâmetro de consulta que o contrato não lista', () => {
    expect(check('listItems').validateRequest(parts({ query: { _: '123' } }))).toEqual([]);
  });

  it('valida o corpo sem converter tipos', () => {
    const json = { contentType: 'application/json; charset=utf-8' };
    const createItem = check('createItem');
    expect(createItem.validateRequest(parts({ ...json, body: { name: 'Curso' } }))).toEqual([]);
    expect(
      createItem.validateRequest(
        parts({ ...json, body: { name: 5, tags: ['a', 'a'], extra: true } }),
      ),
    ).toEqual([
      { path: 'body.extra', message: 'Campo não aceito.' },
      { path: 'body.name', message: 'Deve ser do tipo string.' },
      { path: 'body.tags', message: 'Não pode ter itens repetidos.' },
    ]);
    expect(createItem.validateRequest(parts({ ...json, body: {} }))).toEqual([
      { path: 'body.name', message: 'Campo obrigatório.' },
    ]);
    expect(createItem.validateRequest(parts({ ...json, body: { name: 'x' } }))).toEqual([
      { path: 'body.name', message: 'Deve ter no mínimo 2 caracteres.' },
    ]);
  });

  it('exige o corpo obrigatório e o tipo de conteúdo do contrato', () => {
    expect(check('createItem').validateRequest(parts())).toEqual([
      { path: 'body', message: 'O corpo da requisição é obrigatório.' },
    ]);
    expect(
      check('createItem').validateRequest(parts({ contentType: 'text/plain', body: 'nome' })),
    ).toEqual([{ path: 'body', message: 'Tipo de conteúdo não aceito. Use application/json.' }]);
  });

  it('diz se a operação aceita o Content-Type do corpo', () => {
    const create = check('createItem');
    expect(create.acceptsContentType('application/json', {})).toBe(true);
    expect(create.acceptsContentType('Application/JSON; charset=utf-8', {})).toBe(true);
    expect(create.acceptsContentType('text/plain', 'x')).toBe(false);
    expect(create.acceptsContentType('text/plain', undefined)).toBe(false);
    expect(create.acceptsContentType(undefined, {})).toBe(false);
    // Sem corpo e sem cabeçalho não há tipo a recusar: a falta do corpo é `validation_failed`.
    expect(create.acceptsContentType(undefined, undefined)).toBe(true);
    // Operação sem corpo no contrato: o que vier é ignorado.
    expect(check('listItems').acceptsContentType('text/plain', 'x')).toBe(true);
  });

  it('nunca repete na mensagem o valor recebido', () => {
    const errors = check('login').validateRequest(
      parts({
        contentType: 'application/json',
        body: { email: 'nao-e-email', password: 12345678, senhaExtra: 'segredo-do-usuario' },
      }),
    );
    expect(errors.map((error) => error.path).sort()).toEqual([
      'body.email',
      'body.password',
      'body.senhaExtra',
    ]);
    const text = JSON.stringify(errors);
    expect(text).not.toContain('nao-e-email');
    expect(text).not.toContain('12345678');
    expect(text).not.toContain('segredo-do-usuario');
  });
});

describe('validação da resposta', () => {
  const item = { id: 1, name: 'Curso', createdAt: '2026-11-24T13:45:00Z' };

  it('aceita a resposta que confere com o contrato', () => {
    expect(check('getItem').validateResponse(200, 'application/json; charset=utf-8', item)).toEqual(
      { ok: true },
    );
    expect(
      check('listItems').validateResponse(200, undefined, { items: [item], nextCursor: null }),
    ).toEqual({ ok: true });
    expect(check('deleteItem').validateResponse(204, undefined, undefined)).toEqual({ ok: true });
  });

  it('recusa corpo fora do esquema, sem copiar os valores para o motivo', () => {
    const result = check('getItem').validateResponse(200, 'application/json', {
      id: 1,
      name: 'Curso',
      password: 'segredo-do-usuario',
    });
    expect(result).toMatchObject({ ok: false, reason: 'schema_mismatch' });
    const detail = result.ok ? '' : result.detail;
    expect(detail).toContain('required (createdAt)');
    expect(detail).toContain('additionalProperties (password)');
    expect(detail).not.toContain('segredo-do-usuario');
  });

  it('recusa formato inválido e composição com allOf', () => {
    expect(
      check('getItem').validateResponse(200, 'application/json', { ...item, createdAt: 'ontem' }),
    ).toMatchObject({ ok: false, reason: 'schema_mismatch' });
    expect(
      check('listItems').validateResponse(200, 'application/json', { items: [item] }),
    ).toMatchObject({ ok: false, reason: 'schema_mismatch' });
  });

  it('recusa status e tipo de mídia que o contrato não declara', () => {
    expect(check('getItem').validateResponse(202, 'application/json', item)).toMatchObject({
      ok: false,
      reason: 'undeclared_status',
    });
    expect(check('getItem').validateResponse(200, 'text/html', '<p>')).toMatchObject({
      ok: false,
      reason: 'undeclared_media_type',
    });
    expect(check('deleteItem').validateResponse(204, 'application/json', {})).toMatchObject({
      ok: false,
      reason: 'undeclared_media_type',
    });
    expect(check('getItem').declaresStatus(404)).toBe(true);
    expect(check('getItem').declaresStatus(409)).toBe(false);
  });

  it('entende faixa de status e default', () => {
    const ranged = parseContract({
      openapi: '3.1.0',
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            responses: {
              '200': { description: 'ok' },
              '4XX': {
                description: 'erro do cliente',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
              default: { description: 'outros' },
            },
          },
        },
      },
    });
    const operation = createContractValidator(ranged).for(ranged.operation('a'));
    expect(operation.validateResponse(404, 'application/json', {})).toEqual({ ok: true });
    expect(operation.validateResponse(404, 'application/json', 'texto')).toMatchObject({
      reason: 'schema_mismatch',
    });
    expect(operation.declaresStatus(500)).toBe(true);
  });
});

describe('campo que aceita nulo (type: [string, "null"]) com format ou pattern', () => {
  // As formas do esquema `Meta` dos dois contratos: `logoUrl`, `accentColor`, `sourceCodeUrl`.
  const nullable = parseContract({
    openapi: '3.1.0',
    paths: {
      '/api/v1/brand': {
        get: {
          operationId: 'getBrand',
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Brand' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Brand: {
          type: 'object',
          required: ['logoUrl', 'accentColor', 'sourceCodeUrl'],
          properties: {
            logoUrl: { type: ['string', 'null'], format: 'uri-reference' },
            accentColor: { type: ['string', 'null'], pattern: '^#[0-9A-Fa-f]{6}$' },
            sourceCodeUrl: { type: 'string', format: 'uri' },
          },
          additionalProperties: false,
        },
      },
    },
  });
  const operation = createContractValidator(nullable).for(nullable.operation('getBrand'));
  const brand = {
    logoUrl: '/api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/256.webp',
    accentColor: '#1F6FEB',
    sourceCodeUrl: 'https://example.com/escola/codigo',
  };
  const respond = (body: unknown) => operation.validateResponse(200, 'application/json', body);

  it('aceita o valor no formato e aceita null', () => {
    expect(respond(brand)).toEqual({ ok: true });
    expect(respond({ ...brand, logoUrl: null, accentColor: null })).toEqual({ ok: true });
  });

  it('recusa valor fora do pattern ou do format', () => {
    for (const accentColor of ['azul', '#1F6FE', '#1F6FEB0', 'x#1F6FEB', '']) {
      expect(respond({ ...brand, accentColor })).toMatchObject({
        ok: false,
        reason: 'schema_mismatch',
      });
    }
    expect(respond({ ...brand, logoUrl: 'com espaço.webp' })).toMatchObject({
      ok: false,
      reason: 'schema_mismatch',
    });
    expect(respond({ ...brand, sourceCodeUrl: '/so-o-caminho' })).toMatchObject({
      ok: false,
      reason: 'schema_mismatch',
    });
  });

  it('null não vale para campo só de texto, e campo obrigatório não pode faltar', () => {
    expect(respond({ ...brand, sourceCodeUrl: null })).toMatchObject({ reason: 'schema_mismatch' });
    expect(respond({ ...brand, accentColor: 7 })).toMatchObject({ reason: 'schema_mismatch' });
    const { logoUrl: _logoUrl, ...semLogo } = brand;
    expect(respond(semLogo)).toMatchObject({ reason: 'schema_mismatch' });
  });

  it('o esquema avulso segue a mesma regra', () => {
    const schema = createContractValidator(nullable).schema('Brand');
    expect(schema({ ...brand, accentColor: null })).toEqual([]);
    expect(schema({ ...brand, accentColor: 'azul' })).toHaveLength(1);
  });
});

describe('contrato com esquema inválido', () => {
  const broken = (schema: unknown) =>
    parseContract({
      openapi: '3.1.0',
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            responses: {
              '200': { description: 'ok', content: { 'application/json': { schema } } },
            },
          },
        },
      },
    });

  it('falha ao compilar, e não na primeira requisição', () => {
    for (const schema of [
      { $ref: '#/components/schemas/NaoExiste' },
      { type: 'string', format: 'formato-inventado' },
      { type: 'texto' },
    ]) {
      const contract = broken(schema);
      expect(() => createContractValidator(contract).for(contract.operation('a'))).toThrow(
        ContractError,
      );
    }
  });
});

describe('esquema avulso', () => {
  it('valida contra components.schemas, com tipos exatos e referências resolvidas', () => {
    const problem = validator.schema('Problem');
    expect(problem({ type: 'about:blank', title: 'Erro', status: 404, code: 'not_found' })).toEqual(
      [],
    );
    expect(problem({ type: 'about:blank', title: 'Erro', status: '404', code: 'X' })).toEqual([
      { path: 'Problem.status', message: 'Deve ser do tipo integer.' },
      { path: 'Problem.code', message: 'Formato inválido.' },
    ]);
    // O mesmo validador é reaproveitado.
    expect(validator.schema('Problem')).toBe(problem);
    expect(() => validator.schema('Inexistente')).toThrow(ContractError);
    expect(() => validator.schema('toString')).toThrow(ContractError);
  });
});
