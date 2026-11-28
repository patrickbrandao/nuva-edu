import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  announcementPublishKey,
  archiveAnnouncement,
  type CatalogRequest,
  type ChannelListener,
  closeDatabase,
  countUnreadAnnouncements,
  createAnnouncement,
  createCourse,
  createDatabase,
  type Database,
  deleteAnnouncement,
  grantEntitlement,
  listAnnouncements,
  listenChannel,
  listMyAnnouncements,
  markAnnouncementsSeen,
  publishAnnouncement,
  publishCourse,
  publishDueAnnouncements,
  publishScheduledAnnouncement,
  type Role,
  readAnnouncement,
  readMyAnnouncement,
  USER_EVENTS_CHANNEL,
  unscheduleAnnouncement,
  updateAnnouncement,
} from '../../src/index.ts';

let db: Database;
let admin: { id: string };
let manager: { id: string };
let adminRequest: CatalogRequest;
let listener: ChannelListener;
const events: { userId: string; kind: string; id: number; data: Record<string, unknown> }[] = [];

const HOUR = 3_600_000;

async function user(role: Role = 'student', name = 'Aluna') {
  return db
    .insertInto('users')
    .values({
      name,
      email: `news-${randomUUID()}@example.test`,
      role,
      emailVerifiedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

async function paidCourse(owner?: { id: string }) {
  const course = await createCourse(db, adminRequest, {
    title: `Curso ${randomUUID()}`,
    accessMode: 'paid',
    priceCents: 500,
  });
  await publishCourse(db, adminRequest, course.id).catch(() => undefined);
  if (owner) {
    await db
      .updateTable('courses')
      .set({ ownerId: owner.id })
      .where('id', '=', course.id)
      .execute();
  }
  return course;
}

async function grant(userId: string, courseId: string) {
  const { entitlement } = await db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId,
      productType: 'course',
      productId: courseId,
      source: 'grant',
      sourceId: admin.id,
      grantedReason: 'Teste de novidades',
      notify: false,
    }),
  );
  return entitlement;
}

async function notifications(userId: string, announcementId: string) {
  const rows = await db
    .selectFrom('jobs')
    .select('id')
    .where('type', '=', 'notify')
    .where(sql<boolean>`payload->>'userId' = ${userId}`)
    .where(sql<boolean>`payload->>'type' = 'announcement.published'`)
    .where(sql<boolean>`payload->>'targetId' = ${announcementId}`)
    .execute();
  return rows.length;
}

function publishJobs(announcementId: string) {
  return db
    .selectFrom('jobs')
    .select(['uniqueKey', 'runAt', 'status', 'maxAttempts'])
    .where('type', '=', 'announcement.publish')
    .where(sql<boolean>`payload->>'announcementId' = ${announcementId}`)
    .execute();
}

function news(extra: Record<string, unknown> = {}) {
  return { title: 'Curso novo no ar', bodyMd: 'Confira o **novo curso**.', ...extra };
}

async function published(actorId: string, extra: Record<string, unknown> = {}) {
  const draft = await createAnnouncement(db, actorId, news(extra));
  return publishAnnouncement(db, actorId, draft.id);
}

async function count(userId: string) {
  return (await countUnreadAnnouncements(db, userId)).unreadCount;
}

async function listed(userId: string) {
  return (await listMyAnnouncements(db, userId, { limit: 100 })).items;
}

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 4 });
  admin = await user('admin', 'Admin');
  manager = await user('manager', 'Gerente');
  adminRequest = { actor: { id: admin.id, role: 'admin' }, context: { ip: '127.0.0.1' } };
  listener = listenChannel({
    connectionString: inject('databaseUrl'),
    channel: USER_EVENTS_CHANNEL,
    onNotification: (payload) => {
      events.push(JSON.parse(payload));
    },
  });
  await listener.whenConnected();
});

afterAll(async () => {
  await listener.close();
  await closeDatabase(db);
});

describe('estados, contador e leitura', () => {
  it('rascunho não aparece; publicar sobe o contador; abrir a lista zera; arquivar some', async () => {
    const student = await user();
    const draft = await createAnnouncement(db, manager.id, news());
    expect(draft).toMatchObject({
      status: 'draft',
      audience: 'all',
      pinned: false,
      notify: false,
      publishedAt: null,
      products: [],
    });
    expect(draft.bodyHtml).toContain('<strong>novo curso</strong>');
    expect(await count(student.id)).toBe(0);
    expect((await listed(student.id)).map(({ id }) => id)).not.toContain(draft.id);
    await expect(readMyAnnouncement(db, student.id, draft.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(archiveAnnouncement(db, manager.id, draft.id)).rejects.toMatchObject({
      status: 409,
      code: 'announcement_not_published',
    });
    await expect(
      updateAnnouncement(db, manager.id, draft.id, { notifyAgain: true }),
    ).rejects.toMatchObject({ code: 'announcement_not_published' });

    const live = await publishAnnouncement(db, manager.id, draft.id);
    expect(live.status).toBe('published');
    expect(live.publishedAt).not.toBeNull();
    expect((await publishAnnouncement(db, manager.id, draft.id)).publishedAt).toEqual(
      live.publishedAt,
    );
    expect(await count(student.id)).toBe(1);
    const item = (await listed(student.id)).find(({ id }) => id === draft.id);
    expect(item).toMatchObject({ unread: true, pinned: false, title: 'Curso novo no ar' });
    expect(item).not.toHaveProperty('bodyMd');
    // notify desligado: ninguém recebe notificação.
    expect(await notifications(student.id, draft.id)).toBe(0);

    const seen = await markAnnouncementsSeen(db, student.id);
    expect(seen.unreadCount).toBe(0);
    expect(await count(student.id)).toBe(0);
    expect((await readMyAnnouncement(db, student.id, draft.id)).unread).toBe(false);

    // Editar não torna "não lida"; com "avisar novamente", sim.
    await updateAnnouncement(db, manager.id, draft.id, { title: 'Curso novo, agora com bônus' });
    expect(await count(student.id)).toBe(0);
    const again = await updateAnnouncement(db, manager.id, draft.id, {
      notify: true,
      notifyAgain: true,
    });
    expect(again.publishedAt?.getTime()).toBeGreaterThan(live.publishedAt?.getTime() ?? 0);
    expect(await count(student.id)).toBe(1);
    expect(await notifications(student.id, draft.id)).toBe(1);
    expect(await notifications(manager.id, draft.id)).toBe(0);

    const archived = await archiveAnnouncement(db, manager.id, draft.id);
    expect(archived).toMatchObject({ status: 'archived', pinned: false });
    expect(archived.archivedAt).not.toBeNull();
    expect((await archiveAnnouncement(db, manager.id, draft.id)).status).toBe('archived');
    expect(await count(student.id)).toBe(0);
    expect((await listed(student.id)).map(({ id }) => id)).not.toContain(draft.id);
    await expect(readMyAnnouncement(db, student.id, draft.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await readAnnouncement(db, manager.id, draft.id)).title).toBe(
      'Curso novo, agora com bônus',
    );
    await expect(
      updateAnnouncement(db, manager.id, draft.id, { title: 'De volta à ativa' }),
    ).rejects.toMatchObject({ status: 409, code: 'announcement_archived' });
    await expect(publishAnnouncement(db, manager.id, draft.id)).rejects.toMatchObject({
      code: 'announcement_archived',
    });
    const trail = await db
      .selectFrom('auditLog')
      .select('action')
      .where('targetId', '=', draft.id)
      .orderBy('createdAt')
      .execute();
    expect(trail.map(({ action }) => action)).toEqual([
      'announcement.create',
      'announcement.publish',
      'announcement.update',
      'announcement.update',
      'announcement.archive',
    ]);
  });

  it('recém-cadastrado não vê como não lidas as novidades anteriores ao cadastro', async () => {
    const before = await published(admin.id);
    const newcomer = await user();
    expect(await count(newcomer.id)).toBe(0);
    const old = (await listed(newcomer.id)).find(({ id }) => id === before.id);
    expect(old).toMatchObject({ unread: false });
    const after = await published(admin.id);
    expect(await count(newcomer.id)).toBe(1);
    expect((await listed(newcomer.id)).find(({ id }) => id === after.id)?.unread).toBe(true);
    await markAnnouncementsSeen(db, newcomer.id);
    expect(await count(newcomer.id)).toBe(0);
    const paged = await listMyAnnouncements(db, newcomer.id, { limit: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).not.toBeNull();
    const next = await listMyAnnouncements(db, newcomer.id, { limit: 1, cursor: paged.nextCursor });
    expect(next.items[0]?.id).not.toBe(paged.items[0]?.id);
  });

  it('valida título, corpo, link, público e campos', async () => {
    const invalid = (extra: Record<string, unknown>) =>
      createAnnouncement(db, admin.id, news(extra));
    await expect(invalid({ title: 'Oi' })).rejects.toMatchObject({
      status: 422,
      code: 'announcement_title_invalid',
    });
    await expect(invalid({ title: 'a'.repeat(151) })).rejects.toMatchObject({ status: 422 });
    await expect(invalid({ bodyMd: ' ' })).rejects.toMatchObject({ status: 422 });
    await expect(invalid({ bodyMd: 'x'.repeat(20_001) })).rejects.toMatchObject({ status: 422 });
    for (const linkUrl of [
      'http://exemplo.test',
      '//exemplo.test',
      'javascript:alert(1)',
      'curso',
    ]) {
      await expect(invalid({ linkUrl })).rejects.toMatchObject({
        code: 'announcement_link_invalid',
      });
    }
    await expect(invalid({ linkLabel: 'Ver' })).rejects.toMatchObject({
      code: 'announcement_link_invalid',
    });
    await expect(invalid({ audience: 'vip' })).rejects.toMatchObject({
      code: 'announcement_audience_invalid',
    });
    await expect(invalid({ pinned: 'sim' })).rejects.toMatchObject({
      code: 'announcement_field_invalid',
    });
    await expect(invalid({ coverImageId: randomUUID() })).rejects.toMatchObject({
      code: 'cover_image_invalid',
    });
    await expect(
      invalid({
        audience: 'product',
        products: [{ productType: 'plano', productId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: 'announcement_products_invalid' });
    const internal = await createAnnouncement(
      db,
      admin.id,
      news({ linkUrl: '/cursos/novo', linkLabel: 'Ver o curso' }),
    );
    expect(internal).toMatchObject({ linkUrl: '/cursos/novo', linkLabel: 'Ver o curso' });
    const external = await updateAnnouncement(db, admin.id, internal.id, {
      linkUrl: 'https://exemplo.test/pagina',
    });
    expect(external.linkUrl).toBe('https://exemplo.test/pagina');
    // Tirar o link leva o texto do botão junto.
    const cleared = await updateAnnouncement(db, admin.id, internal.id, { linkUrl: null });
    expect(cleared).toMatchObject({ linkUrl: null, linkLabel: null });
    await expect(updateAnnouncement(db, admin.id, internal.id, {})).rejects.toMatchObject({
      code: 'announcement_patch_empty',
    });
    await expect(
      publishAnnouncement(db, admin.id, internal.id, { publishAt: 'depois' }),
    ).rejects.toMatchObject({ code: 'announcement_publish_at_invalid' });
    await expect(listAnnouncements(db, admin.id, { status: 'x' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(readAnnouncement(db, admin.id, 'x')).rejects.toMatchObject({ status: 404 });
    const student = await user();
    await expect(createAnnouncement(db, student.id, news())).rejects.toMatchObject({ status: 403 });
    await expect(listAnnouncements(db, student.id)).rejects.toMatchObject({ status: 403 });
    await deleteAnnouncement(db, admin.id, internal.id);
    await expect(readAnnouncement(db, admin.id, internal.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('público', () => {
  it('product aparece só para quem tem o produto e para a equipe; perda de acesso tira', async () => {
    const holder = await user('student', 'Com acesso');
    const outsider = await user('student', 'Sem acesso');
    const staff = await user('manager', 'Outra gerente');
    const course = await paidCourse();
    const entitlement = await grant(holder.id, course.id);
    const item = await published(admin.id, {
      audience: 'product',
      products: [{ productType: 'course', productId: course.id }],
      notify: true,
    });
    expect(item.products).toEqual([
      { productType: 'course', productId: course.id, title: course.title, slug: course.slug },
    ]);
    expect((await listed(holder.id)).map(({ id }) => id)).toContain(item.id);
    expect((await listed(staff.id)).map(({ id }) => id)).toContain(item.id);
    expect((await listed(outsider.id)).map(({ id }) => id)).not.toContain(item.id);
    await expect(readMyAnnouncement(db, outsider.id, item.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await count(holder.id)).toBe(1);
    expect(await count(outsider.id)).toBe(0);
    // A notificação vai só ao público; a equipe vê, mas não é avisada.
    expect(await notifications(holder.id, item.id)).toBe(1);
    expect(await notifications(outsider.id, item.id)).toBe(0);
    expect(await notifications(staff.id, item.id)).toBe(0);

    const active = await published(admin.id, { audience: 'active' });
    expect((await listed(holder.id)).map(({ id }) => id)).toContain(active.id);
    expect((await listed(outsider.id)).map(({ id }) => id)).not.toContain(active.id);
    expect(await count(holder.id)).toBe(2);

    await db
      .updateTable('entitlements')
      .set({ revokedAt: new Date(), revokeReason: 'manual' })
      .where('id', '=', entitlement.id)
      .execute();
    expect(await count(holder.id)).toBe(0);
    const after = (await listed(holder.id)).map(({ id }) => id);
    expect(after).not.toContain(item.id);
    expect(after).not.toContain(active.id);
    await expect(readMyAnnouncement(db, holder.id, item.id)).rejects.toMatchObject({ status: 404 });

    // Trocar o público para all devolve a novidade e limpa os produtos.
    const opened = await updateAnnouncement(db, admin.id, item.id, { audience: 'all' });
    expect(opened.products).toEqual([]);
    expect((await listed(outsider.id)).map(({ id }) => id)).toContain(item.id);

    // Suspensão full: nenhuma leitura.
    await db
      .updateTable('users')
      .set({
        suspendedKind: 'full',
        suspendedAt: new Date(),
        suspendedBy: admin.id,
        suspendedReason: 'Teste',
      })
      .where('id', '=', outsider.id)
      .execute();
    await expect(listMyAnnouncements(db, outsider.id)).rejects.toMatchObject({ status: 401 });
    await expect(countUnreadAnnouncements(db, outsider.id)).rejects.toMatchObject({ status: 401 });
    await expect(markAnnouncementsSeen(db, outsider.id)).rejects.toMatchObject({ status: 401 });
  });

  it('instrutor só publica para os próprios cursos e não fixa', async () => {
    const instructor = await user('instructor', 'Instrutora');
    const own = await paidCourse(instructor);
    const foreign = await paidCourse();
    const mine = [{ productType: 'course', productId: own.id }];
    await expect(createAnnouncement(db, instructor.id, news())).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      createAnnouncement(db, instructor.id, news({ audience: 'active' })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createAnnouncement(
        db,
        instructor.id,
        news({
          audience: 'product',
          products: [...mine, { productType: 'course', productId: foreign.id }],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createAnnouncement(db, instructor.id, news({ audience: 'product', products: [] })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createAnnouncement(
        db,
        instructor.id,
        news({ audience: 'product', products: mine, pinned: true }),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const draft = await createAnnouncement(
      db,
      instructor.id,
      news({ audience: 'product', products: mine }),
    );
    const live = await publishAnnouncement(db, instructor.id, draft.id);
    expect(live.status).toBe('published');
    const general = await published(admin.id);
    const theirs = await published(admin.id, {
      audience: 'product',
      products: [{ productType: 'course', productId: foreign.id }],
    });
    const visible = await listAnnouncements(db, instructor.id);
    expect(visible.items.map(({ id }) => id)).toEqual([draft.id]);
    for (const hidden of [general.id, theirs.id]) {
      await expect(readAnnouncement(db, instructor.id, hidden)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        updateAnnouncement(db, instructor.id, hidden, { title: 'Agora é minha' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(archiveAnnouncement(db, instructor.id, hidden)).rejects.toMatchObject({
        status: 404,
      });
      await expect(deleteAnnouncement(db, instructor.id, hidden)).rejects.toMatchObject({
        status: 404,
      });
    }
    await expect(
      updateAnnouncement(db, instructor.id, draft.id, { audience: 'all' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateAnnouncement(db, instructor.id, draft.id, {
        products: [{ productType: 'course', productId: foreign.id }],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateAnnouncement(db, instructor.id, draft.id, { pinned: true }),
    ).rejects.toMatchObject({ status: 403 });
    // As recusas não deixam rastro: a novidade segue com o curso próprio.
    expect((await readAnnouncement(db, instructor.id, draft.id)).products).toHaveLength(1);
    expect((await archiveAnnouncement(db, instructor.id, draft.id)).status).toBe('archived');
  });
});

describe('fixadas', () => {
  it('fixadas vêm no topo e a quarta é recusada', async () => {
    const student = await user();
    const plain = await published(admin.id);
    const pinned: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      pinned.push((await published(manager.id, { pinned: true, title: `Fixada ${index}` })).id);
    }
    const later = await published(admin.id);
    const order = (await listed(student.id)).map(({ id }) => id);
    expect(order.slice(0, 3)).toEqual([...pinned].reverse());
    expect(order.indexOf(later.id)).toBeLessThan(order.indexOf(plain.id));
    expect(order.indexOf(later.id)).toBeGreaterThan(2);

    await expect(createAnnouncement(db, admin.id, news({ pinned: true }))).rejects.toMatchObject({
      status: 422,
      code: 'announcement_pinned_limit',
    });
    await expect(
      updateAnnouncement(db, admin.id, plain.id, { pinned: true }),
    ).rejects.toMatchObject({ code: 'announcement_pinned_limit' });
    // O gatilho do banco cobre a corrida que escapa da conferência do código.
    await expect(
      db.updateTable('announcements').set({ pinned: true }).where('id', '=', plain.id).execute(),
    ).rejects.toMatchObject({ constraint: 'announcements_pinned_limit' });

    // Arquivar solta a fixação e libera a vaga.
    await archiveAnnouncement(db, admin.id, pinned[0] as string);
    const now = await updateAnnouncement(db, admin.id, plain.id, { pinned: true });
    expect(now.pinned).toBe(true);
    await updateAnnouncement(db, admin.id, plain.id, { pinned: false });
    for (const id of pinned.slice(1)) await archiveAnnouncement(db, admin.id, id);
  });
});

describe('agendamento e SSE', () => {
  it('agendada é publicada pela tarefa no horário; reagendar e cancelar trocam a fila', async () => {
    const student = await user();
    const draft = await createAnnouncement(db, manager.id, news({ notify: true }));
    const first = new Date(Date.now() + 2 * HOUR);
    const scheduled = await publishAnnouncement(db, manager.id, draft.id, { publishAt: first });
    expect(scheduled).toMatchObject({ status: 'scheduled', publishedAt: null });
    expect(scheduled.publishAt?.getTime()).toBe(first.getTime());
    const [job] = await publishJobs(draft.id);
    expect(job).toMatchObject({
      uniqueKey: announcementPublishKey(draft.id, first),
      status: 'queued',
      maxAttempts: 3,
    });
    expect(job?.runAt.getTime()).toBe(first.getTime());
    expect(await count(student.id)).toBe(0);
    expect((await listed(student.id)).map(({ id }) => id)).not.toContain(draft.id);
    const firstPayload = { announcementId: draft.id, publishAt: first.toISOString() };
    expect(await publishScheduledAnnouncement(db, firstPayload)).toEqual({
      published: false,
      skipped: 'not_due',
    });

    const second = new Date(Date.now() + 3 * HOUR);
    await publishAnnouncement(db, manager.id, draft.id, { publishAt: second.toISOString() });
    const requeued = await publishJobs(draft.id);
    expect(requeued).toHaveLength(1);
    expect(requeued[0]?.uniqueKey).toBe(announcementPublishKey(draft.id, second));
    expect(await publishScheduledAnnouncement(db, firstPayload)).toEqual({
      published: false,
      skipped: 'rescheduled',
    });

    // Cancelar volta a rascunho e esvazia a fila; agendar de novo recoloca.
    const back = await unscheduleAnnouncement(db, manager.id, draft.id);
    expect(back).toMatchObject({ status: 'draft', publishAt: null });
    expect(await publishJobs(draft.id)).toHaveLength(0);
    expect((await unscheduleAnnouncement(db, manager.id, draft.id)).status).toBe('draft');
    expect(
      await publishScheduledAnnouncement(db, {
        announcementId: draft.id,
        publishAt: second.toISOString(),
      }),
    ).toEqual({ published: false, skipped: 'not_scheduled' });
    await publishAnnouncement(db, manager.id, draft.id, { publishAt: second });

    // O horário chega: a tarefa publica, avisa o público e não repete.
    const due = new Date(Date.now() - 30_000);
    await db
      .updateTable('announcements')
      .set({ publishAt: due })
      .where('id', '=', draft.id)
      .execute();
    const payload = { announcementId: draft.id, publishAt: due.toISOString() };
    expect(await publishScheduledAnnouncement(db, payload)).toEqual({
      published: true,
      skipped: null,
    });
    const live = await readAnnouncement(db, manager.id, draft.id);
    expect(live.status).toBe('published');
    expect(await count(student.id)).toBe(1);
    expect(await notifications(student.id, draft.id)).toBe(1);
    expect(await publishScheduledAnnouncement(db, payload)).toEqual({
      published: false,
      skipped: 'not_scheduled',
    });
    expect(await notifications(student.id, draft.id)).toBe(1);
    const audit = await db
      .selectFrom('auditLog')
      .select(['origin', 'actorUserId'])
      .where('targetId', '=', draft.id)
      .where('action', '=', 'announcement.publish')
      .execute();
    expect(audit).toEqual([{ origin: 'worker', actorUserId: null }]);
    await expect(unscheduleAnnouncement(db, manager.id, draft.id)).rejects.toMatchObject({
      code: 'announcement_not_scheduled',
    });
    expect(
      await publishScheduledAnnouncement(db, { ...payload, announcementId: randomUUID() }),
    ).toEqual({ published: false, skipped: 'not_found' });
  });

  it('a varredura publica as vencidas; apagar tira a tarefa; publishAt passado publica já', async () => {
    const lost = await createAnnouncement(db, admin.id, news());
    const future = new Date(Date.now() + HOUR);
    await publishAnnouncement(db, admin.id, lost.id, { publishAt: future });
    // Tarefa perdida: a varredura do worker cobre.
    await db.deleteFrom('jobs').where('type', '=', 'announcement.publish').execute();
    await db
      .updateTable('announcements')
      .set({ publishAt: new Date(Date.now() - 1000) })
      .where('id', '=', lost.id)
      .execute();
    const aborted = new AbortController();
    aborted.abort();
    expect(await publishDueAnnouncements(db, { signal: aborted.signal })).toBe(0);
    expect(await publishDueAnnouncements(db)).toBe(1);
    expect((await readAnnouncement(db, admin.id, lost.id)).status).toBe('published');
    expect(await publishDueAnnouncements(db)).toBe(0);

    const gone = await createAnnouncement(db, admin.id, news());
    await publishAnnouncement(db, admin.id, gone.id, { publishAt: future });
    expect(await publishJobs(gone.id)).toHaveLength(1);
    await deleteAnnouncement(db, admin.id, gone.id);
    expect(await publishJobs(gone.id)).toHaveLength(0);

    const now = await createAnnouncement(db, admin.id, news());
    const result = await publishAnnouncement(db, admin.id, now.id, {
      publishAt: new Date(Date.now() - HOUR),
    });
    expect(result.status).toBe('published');
    const filtered = await listAnnouncements(db, admin.id, { status: 'published', limit: 1 });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.nextCursor).not.toBeNull();
  });

  it('publicar avisa por SSE, com o contador, só quem vê a novidade e está no classroom', async () => {
    const holder = await user('student', 'Conectada');
    const outsider = await user('student', 'Fora do público');
    const offline = await user('student', 'Sem sessão');
    const course = await paidCourse();
    await grant(holder.id, course.id);
    await grant(offline.id, course.id);
    for (const { id } of [holder, outsider]) {
      await db
        .insertInto('sessions')
        .values({
          userId: id,
          idHash: randomUUID().replaceAll('-', '').repeat(2),
          csrfToken: randomUUID(),
          ip: '127.0.0.1',
          site: 'classroom',
          expiresAt: new Date(Date.now() + HOUR),
        })
        .execute();
    }
    const item = await published(admin.id, {
      audience: 'product',
      products: [{ productType: 'course', productId: course.id }],
    });
    const received = () =>
      events.filter(
        (event) => event.kind === 'announcement.published' && event.data.announcementId === item.id,
      );
    for (let attempt = 0; attempt < 100 && received().length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mine = received();
    expect(mine.map(({ userId }) => userId)).toEqual([holder.id]);
    expect(mine[0]).toMatchObject({ data: { announcementId: item.id, unreadCount: 1 } });
    expect(Number.isInteger(mine[0]?.id)).toBe(true);
  });
});
