import type { TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';

// Banco próprio: a identidade da escola é global e os outros arquivos gravam `school.*` no banco
// da execução.
let isolated: TestDatabase;
let test: TestApp;

beforeAll(async () => {
  isolated = await createIsolatedDatabase();
  test = createTestApp({ DATABASE_URL: isolated.url });
});

afterAll(async () => {
  await test.close();
  await isolated.drop();
});

const LOGO_ID = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';

describe('GET /api/v1/settings/branding', () => {
  it('devolve a identidade com os padrões sem nada gravado', async () => {
    const admin = await createActor(test, 'admin');
    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/settings/branding',
      as: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schoolName: 'nuva-edu',
      logoUrl: null,
      accentColor: null,
      footer: null,
    });
  });

  it('o gerente recebe 403 auditado', async () => {
    const manager = await createActor(test, 'manager');
    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/settings/branding',
      as: manager,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    const denied = await deniedBy(test, manager.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: 'settings.manage', outcome: 'denied' });
  });
});

describe('PUT /api/v1/settings/branding', () => {
  it('grava os quatro campos, devolve a identidade e audita cada chave alterada', async () => {
    const admin = await createActor(test, 'admin');
    const response = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      payload: {
        schoolName: '  Escola Nova  ',
        logoImageId: LOGO_ID.toUpperCase(),
        accentColor: '#1F6FEB',
        footer: '  Rodapé com quebra\nna segunda linha  ',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schoolName: 'Escola Nova',
      logoUrl: `/api/v1/images/${LOGO_ID}/256.webp`,
      accentColor: '#1F6FEB',
      footer: 'Rodapé com quebra\nna segunda linha',
    });

    const audits = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'settings.update')
      .where('actorUserId', '=', admin.id)
      .execute();
    expect(audits.map((row) => row.targetId).sort()).toEqual([
      'school.accent_color',
      'school.email_footer',
      'school.logo_image_id',
      'school.name',
    ]);
    for (const audit of audits) {
      expect(audit).toMatchObject({ targetType: 'setting', outcome: 'ok' });
    }
    const footer = audits.find((row) => row.targetId === 'school.email_footer');
    expect(footer?.details).toMatchObject({
      before: null,
      after: 'Rodapé com quebra\nna segunda linha',
    });

    // O leitor com cache do processo é descartado: o `/meta` já mostra o novo nome.
    const meta = await test.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.json().schoolName).toBe('Escola Nova');
    expect(meta.json().logoUrl).toBe(`/api/v1/images/${LOGO_ID}/256.webp`);
    expect(meta.json().accentColor).toBe('#1F6FEB');
  });

  it('não grava auditoria quando nada muda e remove o rodapé com nulo', async () => {
    const admin = await createActor(test, 'admin');
    const unchanged = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      payload: {
        schoolName: 'Escola Nova',
        logoImageId: LOGO_ID,
        accentColor: '#1F6FEB',
        footer: 'Rodapé com quebra\nna segunda linha',
      },
    });
    expect(unchanged.statusCode).toBe(200);
    expect(await auditCount('school.name')).toBe(1);
    expect(await auditCount('school.email_footer')).toBe(1);

    const removed = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      payload: {
        schoolName: 'Escola Nova',
        logoImageId: null,
        accentColor: null,
        footer: null,
      },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ logoUrl: null, accentColor: null, footer: null });
    expect(await auditCount('school.logo_image_id')).toBe(2);
    expect(await auditCount('school.accent_color')).toBe(2);
    expect(await auditCount('school.email_footer')).toBe(2);
  });

  it('recusa o nome só com espaços apontando o campo do contrato', async () => {
    const admin = await createActor(test, 'admin');
    const response = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      payload: {
        schoolName: '   ',
        logoImageId: null,
        accentColor: null,
        footer: null,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({
        path: 'body.schoolName',
        message: 'Informe o nome da escola.',
      }),
    );
  });

  it('recusa rodapé acima de 500 caracteres sem gravar nada', async () => {
    const admin = await createActor(test, 'admin');
    const before = await brandName();
    const response = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      payload: {
        schoolName: 'Outro Nome',
        logoImageId: null,
        accentColor: null,
        footer: 'x'.repeat(501),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
    // A validação do contrato recusa antes da rota: nada do corpo foi gravado.
    expect(await brandName()).toBe(before);
  });

  it('recusa cor fora do formato e escrita sem CSRF', async () => {
    const admin = await createActor(test, 'admin');
    const color = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      payload: {
        schoolName: 'Escola Nova',
        logoImageId: null,
        accentColor: 'azul',
        footer: null,
      },
    });
    expect(color.statusCode).toBe(400);
    expect(color.json()).toMatchObject({ code: 'validation_failed' });
    expect(color.json().errors).toContainEqual(
      expect.objectContaining({ path: 'body.accentColor' }),
    );

    const csrf = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: admin,
      csrf: null,
      payload: {
        schoolName: 'Escola Nova',
        logoImageId: null,
        accentColor: null,
        footer: null,
      },
    });
    expect(csrf.statusCode).toBe(403);
    expect(csrf.json()).toMatchObject({ code: 'csrf_token_invalid' });
  });

  it('o gerente recebe 403 auditado na escrita', async () => {
    const manager = await createActor(test, 'manager');
    const response = await callAs(test, {
      method: 'PUT',
      url: '/api/v1/settings/branding',
      as: manager,
      payload: {
        schoolName: 'Escola do Gerente',
        logoImageId: null,
        accentColor: null,
        footer: null,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'permission_denied' });
    const denied = await deniedBy(test, manager.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: 'settings.manage', outcome: 'denied' });
  });
});

function auditCount(targetId: string) {
  return test.db
    .selectFrom('auditLog')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('action', '=', 'settings.update')
    .where('targetId', '=', targetId)
    .executeTakeFirst()
    .then((row) => Number(row?.count ?? 0));
}

async function brandName(): Promise<string> {
  const row = await test.db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', 'school.name')
    .executeTakeFirst();
  return row === undefined || typeof row.value !== 'string' ? 'nuva-edu' : row.value;
}
