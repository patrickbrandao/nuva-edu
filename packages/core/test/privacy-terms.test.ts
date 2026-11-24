import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  type AuditContext,
  acceptTerms,
  assertTermsAccepted,
  closeDatabase,
  createDatabase,
  createTermsDraft,
  currentTermsVersions,
  type Database,
  getLegalDocument,
  isDomainError,
  listTermsVersions,
  pendingTermsFor,
  publishTermsVersion,
  TERMS_BODY_MAX_LENGTH,
  type TermsDocument,
} from '../src/index.ts';

let db: Database;
let admin: string;

class Rollback extends Error {}

/** Publicação é permanente (o gatilho recusa DELETE): cada teste roda numa transação desfeita. */
async function rolledBack(work: (trx: Database) => Promise<void>): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await work(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function createUser(trx: Database, role = 'student'): Promise<string> {
  const row = await trx
    .insertInto('users')
    .values({ email: `${randomUUID()}@exemplo.test`, name: 'Pessoa', role })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function context(): AuditContext {
  return { origin: 'admin_panel', actorUserId: admin, actorRole: 'admin', ip: '203.0.113.9' };
}

async function publish(
  trx: Database,
  document: TermsDocument,
  requiresReacceptance = false,
): Promise<string> {
  const draft = await createTermsDraft(trx, {
    document,
    bodyMd: `# ${document} ${randomUUID()}`,
    requiresReacceptance,
  });
  const published = await publishTermsVersion(trx, draft.id, context());
  return published.id;
}

async function expectDomainError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(isDomainError(error)).toBe(true);
  expect(error).toMatchObject({ code, status });
  return error as { errors?: { path: string; message: string }[] };
}

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 3 });
  const row = await db
    .insertInto('users')
    .values({ email: `${randomUUID()}@exemplo.test`, name: 'Ada Admin', role: 'admin' })
    .returning('id')
    .executeTakeFirstOrThrow();
  admin = row.id;
});

afterAll(async () => {
  await closeDatabase(db);
});

describe('versões dos termos', () => {
  it('cria rascunho sem número e publica com o próximo número, auditado', async () => {
    await rolledBack(async (trx) => {
      const draft = await createTermsDraft(trx, { document: 'terms', bodyMd: '# Termos' });
      expect(draft).toMatchObject({
        document: 'terms',
        version: null,
        status: 'draft',
        requiresReacceptance: false,
        effectiveAt: null,
        publishedAt: null,
      });
      const first = await publishTermsVersion(trx, draft.id, context());
      expect(first).toMatchObject({ version: 1, status: 'published' });
      expect(first.publishedAt).toBeInstanceOf(Date);
      expect(first.effectiveAt).toEqual(first.publishedAt);

      const other = await createTermsDraft(trx, {
        document: 'terms',
        bodyMd: '# Termos 2',
        requiresReacceptance: true,
      });
      const privacy = await createTermsDraft(trx, { document: 'privacy', bodyMd: '# Política' });
      expect((await publishTermsVersion(trx, privacy.id, context())).version).toBe(1);
      expect((await publishTermsVersion(trx, other.id, context())).version).toBe(2);

      const audit = await trx
        .selectFrom('auditLog')
        .select(['action', 'targetType', 'targetId', 'details', 'actorUserId'])
        .where('action', '=', 'terms.publish')
        .where('targetId', '=', other.id)
        .executeTakeFirstOrThrow();
      expect(audit).toMatchObject({
        targetType: 'terms_version',
        actorUserId: admin,
        details: { kind: 'terms', version: 2, requiresReacceptance: true },
      });
    });
  });

  it('recusa publicar de novo (409), inexistente (404) e fora de transação', async () => {
    await rolledBack(async (trx) => {
      const id = await publish(trx, 'terms');
      await expectDomainError(
        publishTermsVersion(trx, id, context()),
        'terms_already_published',
        409,
      );
      await expectDomainError(publishTermsVersion(trx, randomUUID(), context()), 'not_found', 404);
      await expectDomainError(publishTermsVersion(trx, 'nao-e-uuid', context()), 'not_found', 404);
    });
    await expect(publishTermsVersion(db, randomUUID(), context())).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('versão publicada é imutável no banco', async () => {
    await rolledBack(async (trx) => {
      const id = await publish(trx, 'privacy');
      for (const attempt of [
        () => trx.updateTable('termsVersions').set({ bodyMd: 'outro' }).where('id', '=', id),
        () => trx.deleteFrom('termsVersions').where('id', '=', id),
      ]) {
        await sql`SAVEPOINT imutavel`.execute(trx);
        await expect(attempt().execute()).rejects.toThrow(/imutável/);
        await sql`ROLLBACK TO SAVEPOINT imutavel`.execute(trx);
      }
    });
  });

  it('valida documento e tamanho do texto', async () => {
    const tooLong = 'a'.repeat(TERMS_BODY_MAX_LENGTH + 1);
    const cases: [string, string][] = [
      ['cookies', '# x'],
      ['terms', ''],
      ['terms', tooLong],
    ];
    for (const [document, bodyMd] of cases) {
      await expectDomainError(createTermsDraft(db, { document, bodyMd }), 'validation_failed', 400);
    }
    await expectDomainError(listTermsVersions(db, 'cookies'), 'validation_failed', 400);
  });

  it('lista mais nova primeiro, com rascunhos; vigente e documento público', async () => {
    await rolledBack(async (trx) => {
      await expectDomainError(getLegalDocument(trx, 'terms'), 'not_found', 404);
      await expectDomainError(getLegalDocument(trx, 'cookies'), 'not_found', 404);
      expect(await currentTermsVersions(trx)).toEqual({ terms: null, privacy: null });

      const v1 = await publish(trx, 'terms');
      const v2 = await publish(trx, 'terms');
      const draft = await createTermsDraft(trx, { document: 'terms', bodyMd: '# rascunho' });

      const list = await listTermsVersions(trx, 'terms');
      expect(list.map((entry) => entry.id)).toEqual([draft.id, v2, v1]);
      expect(list.map((entry) => entry.status)).toEqual(['draft', 'published', 'published']);

      const current = await currentTermsVersions(trx);
      expect(current.terms).toMatchObject({ id: v2, document: 'terms', version: 2 });
      expect(current.privacy).toBeNull();
      const legal = await getLegalDocument(trx, 'terms');
      expect(legal).toMatchObject({ id: v2, version: 2 });
      expect(legal.bodyMd).toMatch(/^# terms /);
    });
  });
});

describe('aceite no cadastro', () => {
  it('sem versão publicada, a lista vazia passa e qualquer id é recusado', async () => {
    await rolledBack(async (trx) => {
      expect(await assertTermsAccepted(trx, [])).toEqual([]);
      const error = await expectDomainError(
        assertTermsAccepted(trx, [randomUUID()]),
        'terms_acceptance_required',
        422,
      );
      expect(error.errors).toEqual([{ path: 'body.acceptedTerms', message: 'unknown' }]);
    });
  });

  it('exige a vigente de cada documento publicado e aponta o documento', async () => {
    await rolledBack(async (trx) => {
      const old = await publish(trx, 'terms');
      const terms = await publish(trx, 'terms');
      const privacy = await publish(trx, 'privacy');

      const missing = await expectDomainError(
        assertTermsAccepted(trx, [terms]),
        'terms_acceptance_required',
        422,
      );
      expect(missing.errors).toEqual([{ path: 'body.acceptedTerms', message: 'privacy' }]);

      const outdated = await expectDomainError(
        assertTermsAccepted(trx, [old, privacy]),
        'terms_acceptance_required',
        422,
      );
      expect(outdated.errors).toEqual([{ path: 'body.acceptedTerms', message: 'terms' }]);

      const accepted = await assertTermsAccepted(trx, [privacy, terms.toUpperCase()]);
      expect(accepted.map((version) => version.id)).toEqual([terms, privacy]);
    });
  });
});

describe('acceptTerms', () => {
  it('grava a vigente com IP e navegador, sem duplicar', async () => {
    await rolledBack(async (trx) => {
      const user = await createUser(trx);
      const terms = await publish(trx, 'terms');
      const privacy = await publish(trx, 'privacy');
      const accepted = await acceptTerms(trx, user, [terms, privacy], '198.51.100.4', 'vitest');
      expect(accepted.map((version) => version.document)).toEqual(['terms', 'privacy']);
      await acceptTerms(trx, user, [terms, terms], 'não é ip', 'x'.repeat(2000));
      const rows = await trx
        .selectFrom('termsAcceptances')
        .select(['termsVersionId', 'ip', 'userAgent'])
        .where('userId', '=', user)
        .orderBy('termsVersionId')
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.termsVersionId === terms)).toMatchObject({
        ip: '198.51.100.4',
        userAgent: 'vitest',
      });
      expect(await acceptTerms(trx, user, [], null, null)).toEqual([]);
    });
  });

  it('recusa versão que não é a vigente, rascunho e id desconhecido (422)', async () => {
    await rolledBack(async (trx) => {
      const user = await createUser(trx);
      const old = await publish(trx, 'terms');
      await publish(trx, 'terms');
      const draft = await createTermsDraft(trx, { document: 'privacy', bodyMd: '# rascunho' });
      const error = await expectDomainError(
        acceptTerms(trx, user, [old, draft.id, randomUUID()], null, null),
        'terms_version_outdated',
        422,
      );
      expect(error.errors).toEqual([
        { path: 'body.termsVersionIds', message: 'terms' },
        { path: 'body.termsVersionIds', message: 'privacy' },
        { path: 'body.termsVersionIds', message: 'unknown' },
      ]);
      const count = await trx
        .selectFrom('termsAcceptances')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('userId', '=', user)
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(0);
    });
  });

  it('exige transação', async () => {
    await expect(acceptTerms(db, admin, [randomUUID()], null, null)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('pendingTermsFor', () => {
  it('a primeira publicação fica pendente para quem se cadastrou antes', async () => {
    await rolledBack(async (trx) => {
      const user = await createUser(trx);
      expect(await pendingTermsFor(trx, user)).toEqual([]);
      const terms = await publish(trx, 'terms');
      expect((await pendingTermsFor(trx, user)).map((version) => version.id)).toEqual([terms]);
      await acceptTerms(trx, user, [terms], null, null);
      expect(await pendingTermsFor(trx, user)).toEqual([]);
    });
  });

  it('versão nova sem requires_reacceptance não fica pendente para quem aceitou a anterior', async () => {
    await rolledBack(async (trx) => {
      const user = await createUser(trx);
      const v1 = await publish(trx, 'terms');
      await acceptTerms(trx, user, [v1], null, null);
      const v2 = await publish(trx, 'terms', false);
      expect(await pendingTermsFor(trx, user)).toEqual([]);
      // Quem se cadastra agora aceita a vigente; a anterior não conta.
      expect((await currentTermsVersions(trx)).terms?.id).toBe(v2);
    });
  });

  it('versão com requires_reacceptance fica pendente até ser aceita', async () => {
    await rolledBack(async (trx) => {
      const user = await createUser(trx);
      const v1 = await publish(trx, 'privacy');
      await acceptTerms(trx, user, [v1], null, null);
      const v2 = await publish(trx, 'privacy', true);
      expect((await pendingTermsFor(trx, user)).map((version) => version.id)).toEqual([v2]);
      // Uma versão 3 sem novo aceite não apaga a pendência que a 2 criou.
      const v3 = await publish(trx, 'privacy', false);
      expect((await pendingTermsFor(trx, user)).map((version) => version.id)).toEqual([v3]);
      await acceptTerms(trx, user, [v3], null, null);
      expect(await pendingTermsFor(trx, user)).toEqual([]);
    });
  });

  it('quem nunca aceitou continua pendente mesmo depois de uma versão 2 sem novo aceite', async () => {
    await rolledBack(async (trx) => {
      const user = await createUser(trx);
      await publish(trx, 'terms');
      const v2 = await publish(trx, 'terms', false);
      expect((await pendingTermsFor(trx, user)).map((version) => version.id)).toEqual([v2]);
    });
  });
});

// Por último no arquivo: este teste grava (commit) versões publicadas, que não podem ser apagadas.
describe('publicação simultânea', () => {
  it('duas publicações do mesmo documento recebem números distintos e em sequência', async () => {
    const drafts = await Promise.all(
      [1, 2, 3].map((n) => createTermsDraft(db, { document: 'terms', bodyMd: `# corrida ${n}` })),
    );
    const published = await Promise.all(
      drafts.map((draft) =>
        db.transaction().execute((trx) => publishTermsVersion(trx, draft.id, context())),
      ),
    );
    const versions = published.map((entry) => entry.version ?? 0).sort((a, b) => a - b);
    const base = (versions[0] ?? 1) - 1;
    expect(versions).toEqual([base + 1, base + 2, base + 3]);
    const again = await Promise.allSettled(
      [0, 1].map(() =>
        db.transaction().execute((trx) => publishTermsVersion(trx, drafts[0]?.id ?? '', context())),
      ),
    );
    expect(again.every((result) => result.status === 'rejected')).toBe(true);
  });
});
