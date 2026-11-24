import { businessRule, rateLimited, unavailable } from '@nuva-edu/core';
import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable, ResponseContractError, resolveError } from '../src/index.ts';

function withCode(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields);
}

describe('resolveError', () => {
  it('mantém código, status e extras do DomainError', () => {
    expect(
      resolveError(businessRule('last_admin', 'Não dá para remover.'), '/api/v1/users/1'),
    ).toEqual({
      kind: 'expected',
      problem: {
        type: 'about:blank',
        title: 'Regra de negócio não atendida',
        status: 422,
        code: 'last_admin',
        detail: 'Não dá para remover.',
        instance: '/api/v1/users/1',
      },
    });
    expect(resolveError(rateLimited(30), undefined).problem).toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 30,
    });
    expect(resolveError(unavailable('payment_provider_unavailable'), undefined)).toMatchObject({
      kind: 'unexpected',
      problem: { status: 503, code: 'payment_provider_unavailable' },
    });
  });

  it('erro qualquer vira internal_error sem detalhe', () => {
    const resolved = resolveError(new Error('senha=abc123 falhou no host interno'), '/x');
    expect(resolved).toEqual({
      kind: 'unexpected',
      problem: {
        type: 'about:blank',
        title: 'Erro interno',
        status: 500,
        code: 'internal_error',
        instance: '/x',
      },
    });
    expect(resolveError('texto solto', undefined).problem.code).toBe('internal_error');
    expect(
      resolveError(new ResponseContractError('schema_mismatch', 'GET /x: fora'), undefined).problem,
    ).toMatchObject({ status: 500, code: 'internal_error' });
  });

  it('erros de requisição do Fastify viram validation_failed, salvo 413 e 415', () => {
    const invalidJson = withCode('Unexpected token', {
      code: 'FST_ERR_CTP_INVALID_JSON_BODY',
      statusCode: 400,
    });
    expect(resolveError(invalidJson, '/x')).toMatchObject({
      kind: 'expected',
      problem: {
        status: 400,
        code: 'validation_failed',
        detail: 'O corpo não é um JSON válido.',
        errors: [{ path: 'body', message: 'O corpo não é um JSON válido.' }],
      },
    });
    const tooLarge = withCode('too large', { code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 });
    expect(resolveError(tooLarge, '/x')).toMatchObject({
      kind: 'expected',
      problem: {
        status: 413,
        code: 'payload_too_large',
        detail: 'O corpo da requisição passa do tamanho permitido.',
      },
    });
    const mediaType = withCode('unsupported', {
      code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
      statusCode: 415,
    });
    expect(resolveError(mediaType, '/x')).toMatchObject({
      kind: 'expected',
      problem: { status: 415, code: 'unsupported_media_type' },
    });
    const badUrl = withCode('bad url', { code: 'FST_ERR_BAD_URL', statusCode: 400 });
    expect(resolveError(badUrl, '/x').problem).toMatchObject({
      status: 400,
      code: 'validation_failed',
      errors: [],
    });
    const notFound = withCode('not found', { code: 'FST_ERR_NOT_FOUND', statusCode: 404 });
    expect(resolveError(notFound, '/x').problem).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('statusCode de quem não é o Fastify não é aceito como resposta', () => {
    const foreign = withCode('teapot', { statusCode: 418 });
    expect(resolveError(foreign, undefined).problem.code).toBe('internal_error');
    const fastify5xx = withCode('boom', {
      code: 'FST_ERR_REP_INVALID_PAYLOAD_TYPE',
      statusCode: 500,
    });
    expect(resolveError(fastify5xx, undefined).problem.code).toBe('internal_error');
  });

  it('banco fora do ar vira database_unavailable (503)', () => {
    const refused = withCode('connect ECONNREFUSED 127.0.0.1:5432', { code: 'ECONNREFUSED' });
    expect(resolveError(refused, '/x')).toMatchObject({
      kind: 'unexpected',
      problem: { status: 503, code: 'database_unavailable' },
    });
  });
});

describe('isDatabaseUnavailable', () => {
  it.each([
    ['conexão recusada', withCode('x', { code: 'ECONNREFUSED' })],
    ['host não resolvido', withCode('x', { code: 'ENOTFOUND' })],
    ['servidor iniciando', withCode('x', { code: '57P03' })],
    ['derrubado pelo administrador', withCode('x', { code: '57P01' })],
    ['conexões esgotadas', withCode('x', { code: '53300' })],
    ['classe 08', withCode('x', { code: '08006' })],
    ['pool sem conexão', new Error('timeout exceeded when trying to connect')],
    ['conexão encerrada', new Error('Connection terminated unexpectedly')],
    ['dentro de AggregateError', new AggregateError([withCode('x', { code: 'ECONNREFUSED' })])],
    ['na causa', new Error('consulta falhou', { cause: withCode('x', { code: 'ECONNRESET' }) })],
  ])('reconhece %s', (_name, error) => {
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it.each([
    ['violação de unicidade', withCode('x', { code: '23505' })],
    ['erro de sintaxe', withCode('x', { code: '42601' })],
    ['erro comum', new Error('falhou')],
    ['valor que não é erro', 'ECONNREFUSED'],
  ])('ignora %s', (_name, error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
  });
});
