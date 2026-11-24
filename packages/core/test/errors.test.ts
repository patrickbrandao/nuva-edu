import { describe, expect, it } from 'vitest';
import {
  businessRule,
  conflict,
  DomainError,
  isDomainError,
  notFound,
  PROBLEM_CONTENT_TYPE,
  permissionDenied,
  rateLimited,
  toProblem,
  unauthenticated,
  unavailable,
  validationFailed,
} from '../src/index.ts';

describe('DomainError', () => {
  it('guarda código, status, título e causa', () => {
    const cause = new Error('origem');
    const error = new DomainError({
      code: 'coupon_expired',
      status: 422,
      title: 'Regra de negócio não atendida',
      detail: 'O cupom venceu.',
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.message).toBe('O cupom venceu.');
    expect(error.cause).toBe(cause);
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
  });

  it('usa o título como mensagem quando não há detalhe', () => {
    expect(notFound().message).toBe('Não encontrado');
  });

  it('recusa código fora de snake_case e status fora de 400 a 599', () => {
    expect(() => conflict('Version-Mismatch')).toThrow(TypeError);
    expect(() => new DomainError({ code: 'ok', status: 200, title: 'x' })).toThrow(TypeError);
    expect(() => new DomainError({ code: 'ok', status: 404.5, title: 'x' })).toThrow(TypeError);
  });

  it.each([
    [validationFailed([{ path: 'body.email', message: 'obrigatório' }]), 400, 'validation_failed'],
    [unauthenticated(), 401, 'unauthenticated'],
    [permissionDenied(), 403, 'permission_denied'],
    [notFound(), 404, 'not_found'],
    [conflict('version_mismatch'), 409, 'version_mismatch'],
    [businessRule('coupon_expired'), 422, 'coupon_expired'],
    [rateLimited(), 429, 'rate_limited'],
    [unavailable('database_unavailable'), 503, 'database_unavailable'],
  ])('fábrica %# usa o status e o código da spec 003', (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(toProblem(error)).toMatchObject({ type: 'about:blank', status, code });
  });
});

describe('toProblem', () => {
  it('usa o tipo de mídia da RFC 9457', () => {
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });

  it('converte erro de validação com a lista de campos e a instância', () => {
    const error = validationFailed(
      [{ path: 'body.email', message: 'E-mail inválido.' }],
      'Confira os campos.',
    );
    expect(toProblem(error, { instance: '/api/v1/users' })).toEqual({
      type: 'about:blank',
      title: 'Dados inválidos',
      status: 400,
      code: 'validation_failed',
      detail: 'Confira os campos.',
      instance: '/api/v1/users',
      errors: [{ path: 'body.email', message: 'E-mail inválido.' }],
    });
  });

  it('omite detail, instance e errors quando não existem', () => {
    expect(toProblem(permissionDenied())).toEqual({
      type: 'about:blank',
      title: 'Sem permissão',
      status: 403,
      code: 'permission_denied',
    });
  });

  it('inclui campos extras sem deixar que sobrescrevam os do padrão', () => {
    expect(toProblem(rateLimited(30))).toMatchObject({ status: 429, retryAfterSeconds: 30 });
    const error = new DomainError({
      code: 'conflict',
      status: 409,
      title: 'Conflito de estado',
      extras: { status: 200, code: 'forjado', currentVersion: 4 },
    });
    expect(toProblem(error)).toMatchObject({ status: 409, code: 'conflict', currentVersion: 4 });
  });

  it('esconde qualquer erro que não seja de domínio atrás de internal_error', () => {
    const leaked = new Error('falha ao gravar senha "abc123" em users');
    for (const error of [leaked, 'texto', null, undefined, { status: 418, code: 'teapot' }]) {
      expect(toProblem(error, { instance: '/api/v1/x' })).toEqual({
        type: 'about:blank',
        title: 'Erro interno',
        status: 500,
        code: 'internal_error',
        instance: '/api/v1/x',
      });
    }
  });

  it('guarda a causa do erro de dependência sem expô-la', () => {
    const error = unavailable('database_unavailable', undefined, new Error('ECONNREFUSED db:5432'));
    expect(JSON.stringify(toProblem(error))).not.toContain('ECONNREFUSED');
    expect((error.cause as Error).message).toContain('ECONNREFUSED');
  });
});
