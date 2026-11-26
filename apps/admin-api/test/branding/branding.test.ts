import { randomUUID } from 'node:crypto';
import type { TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';
import { png, uploadImage } from '../image-fixtures.ts';

// Banco próprio: a identidade da escola é global e os outros arquivos gravam `school.*` no banco
// da execução.
let isolated: TestDatabase;
let test: TestApp;
/** Logotipo real enviado pelo `admin`: a identidade só aceita uma imagem `school_logo` viva. */
let logoId: string;

beforeAll(async () => {
  isolated = await createIsolatedDatabase();
  test = createTestApp({ DATABASE_URL: isolated.url });

  const admin = await createActor(test, 'admin');
  const uploaded = await uploadImage(test, admin, {
    purpose: 'school_logo',
    file: png(40, 30),
  });
  if (uploaded.statusCode !== 201) {
    throw new Error(`envio do logotipo de teste falhou: ${uploaded.statusCode} ${uploaded.body}`);
  }
  logoId = uploaded.json().id;
});

afterAll(async () => {
  await test.close();
  await isolated.drop();
});

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
        logoImageId: logoId.toUpperCase(),
        accentColor: '#1F6FEB',
        footer: '  Rodapé com quebra\nna segunda linha  ',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schoolName: 'Escola Nova',
      logoUrl: `/api/v1/images/${logoId}/256.webp`,
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
    expect(meta.json().logoUrl).toBe(`/api/v1/images/${logoId}/256.webp`);
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
        logoImageId: logoId,
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

  it('recusa logotipo inexistente, oculto ou de outra finalidade com 422 e nada grava', async () => {
    const admin = await createActor(test, 'admin');
    const before = (await getBranding(admin)).json();
    const auditsBefore = await auditCount('school.name');
    const payload = (logoImageId: string) => ({
      schoolName: 'Escola do Logotipo Inválido',
      logoImageId,
      accentColor: '#000000',
      footer: 'não deve ser gravado',
    });

    // Identificador que não corresponde a imagem alguma.
    const missing = await saveBranding(admin, payload(randomUUID()));
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({ code: 'image_purpose_mismatch' });

    // Imagem oculta pela moderação (spec 026).
    const hidden = (await uploadImage(test, admin, { purpose: 'school_logo' })).json();
    await test.db
      .updateTable('images')
      .set({ hiddenAt: new Date() })
      .where('id', '=', hidden.id)
      .execute();
    const hiddenResponse = await saveBranding(admin, payload(hidden.id));
    expect(hiddenResponse.statusCode).toBe(422);
    expect(hiddenResponse.json()).toMatchObject({ code: 'image_purpose_mismatch' });

    // Imagem existente, mas de outra finalidade (capa de produto).
    const manager = await createActor(test, 'manager');
    const cover = (await uploadImage(test, manager)).json();
    const wrongPurpose = await saveBranding(admin, payload(cover.id));
    expect(wrongPurpose.statusCode).toBe(422);
    expect(wrongPurpose.json()).toMatchObject({ code: 'image_purpose_mismatch' });

    // A transação inteira desfez: nome, cor, rodapé e logotipo continuam como estavam.
    expect((await getBranding(admin)).json()).toEqual(before);
    expect(await auditCount('school.name')).toBe(auditsBefore);
  });

  it('grava o logotipo, serve a variante de 256 e protege a imagem em uso', async () => {
    const admin = await createActor(test, 'admin');
    const image = (
      await uploadImage(test, admin, { purpose: 'school_logo', file: png(40, 30) })
    ).json();

    const saved = await saveBranding(admin, {
      schoolName: 'Escola com Logo',
      logoImageId: image.id,
      accentColor: null,
      footer: null,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      schoolName: 'Escola com Logo',
      logoUrl: `/api/v1/images/${image.id}/256.webp`,
    });

    // A leitura devolve o mesmo `logoUrl`, e a entrega serve a variante de 256.
    const read = await getBranding(admin);
    expect(read.json().logoUrl).toBe(`/api/v1/images/${image.id}/256.webp`);
    const delivered = await test.app.inject({ method: 'GET', url: read.json().logoUrl });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers['content-type']).toBe('image/webp');

    // Em uso: nem quem enviou apaga; é 404, como qualquer imagem referenciada.
    const inUse = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${image.id}`,
      as: admin,
    });
    expect(inUse.statusCode).toBe(404);
    expect(inUse.json()).toMatchObject({ code: 'not_found' });

    // Sem o logotipo na identidade, a imagem solta pode ser apagada.
    const cleared = await saveBranding(admin, {
      schoolName: 'Escola com Logo',
      logoImageId: null,
      accentColor: null,
      footer: null,
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().logoUrl).toBeNull();
    const removed = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${image.id}`,
      as: admin,
    });
    expect(removed.statusCode).toBe(204);
    const gone = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${image.id}/256.webp`,
    });
    expect(gone.statusCode).toBe(404);
  });
});

interface BrandingPayload {
  schoolName: string;
  logoImageId: string | null;
  accentColor: string | null;
  footer: string | null;
}

function getBranding(as: Actor) {
  return callAs(test, { method: 'GET', url: '/api/v1/settings/branding', as });
}

function saveBranding(as: Actor, payload: BrandingPayload) {
  return callAs(test, { method: 'PUT', url: '/api/v1/settings/branding', as, payload });
}

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
