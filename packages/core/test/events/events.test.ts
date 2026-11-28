import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  type CatalogRequest,
  cancelEvent,
  closeDatabase,
  createCourse,
  createDatabase,
  createEvent,
  createLesson,
  createModule,
  type Database,
  deleteEvent,
  EVENT_REMINDER_LEAD_MS,
  eventReminderKey,
  eventStatus,
  getEventView,
  grantEntitlement,
  joinEvent,
  listEventAgenda,
  listEventRecordings,
  listEvents,
  listLiveEvents,
  publishCourse,
  type Role,
  readEvent,
  sendEventReminder,
  updateEvent,
} from '../../src/index.ts';

let db: Database;
let admin: { id: string };
let manager: { id: string };
let adminRequest: CatalogRequest;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STREAM = 'https://meet.example.test/sala-secreta';

async function user(role: Role = 'student', name = 'Aluna') {
  return db
    .insertInto('users')
    .values({
      name,
      email: `event-${randomUUID()}@example.test`,
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
  const module = await createModule(db, adminRequest, course.id, { title: 'Módulo' });
  const lesson = await createLesson(db, adminRequest, module.id, {
    title: 'Gravação da live',
    videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    status: 'published',
  });
  await publishCourse(db, adminRequest, course.id);
  if (owner) {
    await db
      .updateTable('courses')
      .set({ ownerId: owner.id })
      .where('id', '=', course.id)
      .execute();
  }
  return { course, lesson };
}

async function grant(userId: string, courseId: string) {
  const { entitlement } = await db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId,
      productType: 'course',
      productId: courseId,
      source: 'grant',
      sourceId: admin.id,
      grantedReason: 'Teste de eventos',
      notify: false,
    }),
  );
  return entitlement;
}

async function notifications(userId: string, type: string, eventId: string) {
  const rows = await db
    .selectFrom('jobs')
    .select('id')
    .where('type', '=', 'notify')
    .where(sql<boolean>`payload->>'userId' = ${userId}`)
    .where(sql<boolean>`payload->>'type' = ${type}`)
    .where(sql<boolean>`payload->>'targetId' = ${eventId}`)
    .execute();
  return rows.length;
}

function reminders(eventId: string) {
  return db
    .selectFrom('jobs')
    .select(['uniqueKey', 'runAt', 'payload', 'status', 'maxAttempts'])
    .where('type', '=', 'event.reminder')
    .where(sql<boolean>`payload->>'eventId' = ${eventId}`)
    .orderBy('runAt')
    .execute();
}

function base(startsInMs: number, extra: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + startsInMs);
  return {
    title: 'Live de abertura',
    descriptionMd: 'Encontro **ao vivo** com a turma.',
    kind: 'live',
    startsAt,
    endsAt: new Date(startsAt.getTime() + HOUR),
    streamUrl: STREAM,
    ...extra,
  };
}

async function one(actorId: string, input: Parameters<typeof createEvent>[2]) {
  const [event] = await createEvent(db, actorId, input);
  if (!event) throw new Error('Evento não criado.');
  return event;
}

function shift(eventId: string, startsInMs: number) {
  const startsAt = new Date(Date.now() + startsInMs);
  return db
    .updateTable('events')
    .set({ startsAt, endsAt: new Date(startsAt.getTime() + HOUR) })
    .where('id', '=', eventId)
    .execute();
}

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 4 });
  admin = await user('admin', 'Admin');
  manager = await user('manager', 'Gerente');
  adminRequest = { actor: { id: admin.id, role: 'admin' }, context: { ip: '127.0.0.1' } };
});

afterAll(async () => {
  await closeDatabase(db);
});

describe('regras e validação', () => {
  it('status sai do relógio; só o cancelamento é guardado', () => {
    const startsAt = new Date('2030-01-01T10:00:00Z');
    const endsAt = new Date('2030-01-01T11:00:00Z');
    const event = { startsAt, endsAt, canceledAt: null };
    expect(eventStatus(event, new Date('2030-01-01T09:59:59Z'))).toBe('upcoming');
    expect(eventStatus(event, startsAt)).toBe('live');
    expect(eventStatus(event, new Date('2030-01-01T10:59:59Z'))).toBe('live');
    expect(eventStatus(event, endsAt)).toBe('past');
    expect(eventStatus({ ...event, canceledAt: new Date() }, startsAt)).toBe('canceled');
  });

  it('recusa duração, link, título, tipo, público e repetição inválidos', async () => {
    const startsAt = new Date(Date.now() + HOUR);
    const invalid = (extra: Record<string, unknown>) =>
      createEvent(db, admin.id, base(HOUR, extra));
    await expect(invalid({ startsAt, endsAt: startsAt })).rejects.toMatchObject({
      status: 422,
      code: 'event_time_invalid',
    });
    await expect(
      invalid({ startsAt, endsAt: new Date(startsAt.getTime() + 12 * HOUR + 1000) }),
    ).rejects.toMatchObject({ status: 422, code: 'event_time_invalid' });
    await expect(invalid({ startsAt: 'amanhã' })).rejects.toMatchObject({
      code: 'event_time_invalid',
    });
    await expect(invalid({ streamUrl: 'http://meet.example.test/x' })).rejects.toMatchObject({
      code: 'event_stream_url_invalid',
    });
    await expect(invalid({ streamUrl: 'javascript:alert(1)' })).rejects.toMatchObject({
      code: 'event_stream_url_invalid',
    });
    await expect(invalid({ title: ' ' })).rejects.toMatchObject({ code: 'event_title_invalid' });
    await expect(invalid({ title: 'a'.repeat(161) })).rejects.toMatchObject({ status: 422 });
    await expect(invalid({ descriptionMd: '' })).rejects.toMatchObject({ status: 422 });
    await expect(invalid({ kind: 'festa' })).rejects.toMatchObject({ code: 'event_kind_invalid' });
    await expect(invalid({ audience: 'vip' })).rejects.toMatchObject({
      code: 'event_audience_invalid',
    });
    await expect(invalid({ repeatWeeks: 27 })).rejects.toMatchObject({
      code: 'event_repeat_invalid',
    });
    await expect(invalid({ courseId: randomUUID() })).rejects.toMatchObject({
      code: 'event_course_invalid',
    });
    await expect(invalid({ recordingLessonId: randomUUID() })).rejects.toMatchObject({
      code: 'event_recording_invalid',
    });
    await expect(invalid({ coverImageId: randomUUID() })).rejects.toMatchObject({
      code: 'cover_image_invalid',
    });
    await expect(
      invalid({
        audience: 'product',
        products: [{ productType: 'course', productId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ code: 'event_products_invalid' });
    const student = await user();
    await expect(createEvent(db, student.id, base(HOUR))).rejects.toMatchObject({ status: 403 });
    await expect(listEvents(db, student.id)).rejects.toMatchObject({ status: 403 });
    await expect(readEvent(db, admin.id, 'x')).rejects.toMatchObject({ status: 404 });
  });

  it('guarda o horário em UTC e aceita 12 horas exatas', async () => {
    const event = await one(admin.id, {
      ...base(0),
      startsAt: '2031-05-01T19:00:00-03:00',
      endsAt: '2031-05-02T07:00:00-03:00',
    });
    expect(event.startsAt.toISOString()).toBe('2031-05-01T22:00:00.000Z');
    expect(event.endsAt.toISOString()).toBe('2031-05-02T10:00:00.000Z');
    expect(event).toMatchObject({ status: 'upcoming', audience: 'all', seriesId: null });
    expect(event.descriptionHtml).toContain('<strong>ao vivo</strong>');
  });
});

describe('público e link de transmissão', () => {
  it('evento product entrega o link só a quem tem o produto, na janela de 15 minutos', async () => {
    const holder = await user('student', 'Com acesso');
    const outsider = await user('student', 'Sem acesso');
    const instructor = await user('instructor', 'Instrutor');
    const { course } = await paidCourse();
    await grant(holder.id, course.id);
    const event = await one(manager.id, {
      ...base(HOUR),
      audience: 'product',
      products: [{ productType: 'course', productId: course.id }],
    });
    expect(event.products).toEqual([
      { productType: 'course', productId: course.id, title: course.title, slug: course.slug },
    ]);
    expect(event.streamUrl).toBe(STREAM);

    // Só o público é avisado; quem criou, não.
    expect(await notifications(holder.id, 'event.created', event.id)).toBe(1);
    expect(await notifications(outsider.id, 'event.created', event.id)).toBe(0);
    expect(await notifications(manager.id, 'event.created', event.id)).toBe(0);
    const created = await db
      .selectFrom('jobs')
      .select('payload')
      .where('type', '=', 'notify')
      .where(sql<boolean>`payload->>'targetId' = ${event.id}`)
      .execute();
    expect(JSON.stringify(created)).not.toContain('sala-secreta');

    const blocked = await getEventView(db, outsider.id, event.id);
    expect(blocked).toMatchObject({ canJoin: false, audience: 'product', status: 'upcoming' });
    expect(blocked.products).toHaveLength(1);
    expect(blocked.joinOpensAt.getTime()).toBe(event.startsAt.getTime() - 15 * MINUTE);
    expect(JSON.stringify(blocked)).not.toContain('sala-secreta');
    await expect(joinEvent(db, outsider.id, event.id)).rejects.toMatchObject({
      status: 403,
      code: 'event_forbidden',
    });

    const range = { from: new Date(Date.now() - HOUR), to: new Date(Date.now() + 3 * HOUR) };
    const agenda = await listEventAgenda(db, holder.id, range);
    const listed = agenda.items.find(({ id }) => id === event.id);
    expect(listed).toMatchObject({ canJoin: true, hasRecording: false });
    expect(JSON.stringify(agenda)).not.toContain('sala-secreta');
    expect(Math.abs(agenda.serverTime.getTime() - Date.now())).toBeLessThan(MINUTE);
    const other = await listEventAgenda(db, outsider.id, range);
    expect(other.items.find(({ id }) => id === event.id)?.canJoin).toBe(false);

    // Antes da janela: 409 com o horário de abertura, também para a equipe.
    const early = await joinEvent(db, holder.id, event.id).catch((reason) => reason);
    expect(early).toMatchObject({ status: 409, code: 'event_not_open' });
    expect(early.extras.opensAt).toBe(
      new Date(event.startsAt.getTime() - 15 * MINUTE).toISOString(),
    );
    await expect(joinEvent(db, manager.id, event.id)).rejects.toMatchObject({
      code: 'event_not_open',
    });

    await shift(event.id, 14 * MINUTE);
    expect(await joinEvent(db, holder.id, event.id)).toMatchObject({ streamUrl: STREAM });
    expect((await joinEvent(db, manager.id, event.id)).streamUrl).toBe(STREAM);
    expect((await joinEvent(db, instructor.id, event.id)).streamUrl).toBe(STREAM);
    await expect(joinEvent(db, outsider.id, event.id)).rejects.toMatchObject({
      code: 'event_forbidden',
    });

    // Ao vivo: entra no banner só de quem pode acompanhar.
    await shift(event.id, -10 * MINUTE);
    expect((await joinEvent(db, holder.id, event.id)).streamUrl).toBe(STREAM);
    expect((await getEventView(db, holder.id, event.id)).status).toBe('live');
    expect((await listLiveEvents(db, holder.id)).items.map(({ id }) => id)).toContain(event.id);
    expect((await listLiveEvents(db, outsider.id)).items.map(({ id }) => id)).not.toContain(
      event.id,
    );

    // Perda de acesso fecha o link.
    await db
      .updateTable('entitlements')
      .set({ revokedAt: new Date(), revokeReason: 'manual' })
      .where('userId', '=', holder.id)
      .execute();
    await expect(joinEvent(db, holder.id, event.id)).rejects.toMatchObject({
      code: 'event_forbidden',
    });

    await shift(event.id, -2 * HOUR);
    await expect(joinEvent(db, manager.id, event.id)).rejects.toMatchObject({
      status: 409,
      code: 'event_ended',
    });
    expect((await readEvent(db, manager.id, event.id)).status).toBe('past');
  });

  it('all atende qualquer cadastrado; active, só quem tem direito a produto não aberto', async () => {
    const holder = await user();
    const outsider = await user();
    const { course } = await paidCourse();
    await grant(holder.id, course.id);
    const open = await one(admin.id, base(10 * MINUTE));
    const active = await one(admin.id, base(10 * MINUTE, { audience: 'active' }));
    const noLink = await one(admin.id, base(10 * MINUTE, { streamUrl: null }));
    expect((await joinEvent(db, outsider.id, open.id)).streamUrl).toBe(STREAM);
    expect((await joinEvent(db, holder.id, active.id)).streamUrl).toBe(STREAM);
    await expect(joinEvent(db, outsider.id, active.id)).rejects.toMatchObject({
      code: 'event_forbidden',
    });
    expect((await joinEvent(db, manager.id, active.id)).streamUrl).toBe(STREAM);
    await expect(joinEvent(db, holder.id, noLink.id)).rejects.toMatchObject({
      status: 409,
      code: 'event_link_unavailable',
    });
    expect(await notifications(holder.id, 'event.created', active.id)).toBe(1);
    expect(await notifications(outsider.id, 'event.created', active.id)).toBe(0);
    expect(await notifications(outsider.id, 'event.created', open.id)).toBe(1);

    await expect(
      listEventAgenda(db, holder.id, { from: 'x', to: new Date() }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listEventAgenda(db, holder.id, {
        from: new Date(),
        to: new Date(Date.now() + 90 * 24 * HOUR),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(getEventView(db, holder.id, randomUUID())).rejects.toMatchObject({ status: 404 });

    // Suspensão full: nenhuma leitura; posting não bloqueia a agenda.
    await db
      .updateTable('users')
      .set({
        suspendedKind: 'posting',
        suspendedAt: new Date(),
        suspendedBy: admin.id,
        suspendedReason: 'Teste',
      })
      .where('id', '=', outsider.id)
      .execute();
    expect((await getEventView(db, outsider.id, open.id)).canJoin).toBe(true);
    await db
      .updateTable('users')
      .set({ suspendedKind: 'full' })
      .where('id', '=', outsider.id)
      .execute();
    const range = { from: new Date(), to: new Date(Date.now() + HOUR) };
    await expect(listEventAgenda(db, outsider.id, range)).rejects.toMatchObject({ status: 401 });
    await expect(joinEvent(db, outsider.id, open.id)).rejects.toMatchObject({ status: 401 });
    await expect(listLiveEvents(db, outsider.id)).rejects.toMatchObject({ status: 401 });
    await expect(listEventRecordings(db, outsider.id)).rejects.toMatchObject({ status: 401 });
  });
});

describe('recorrência, lembretes e cancelamento', () => {
  it('repetição semanal por 4 semanas cria 4 eventos independentes e avisa uma vez', async () => {
    const student = await user();
    const events = await createEvent(db, admin.id, base(2 * 24 * HOUR, { repeatWeeks: 4 }));
    expect(events).toHaveLength(4);
    const [first, second] = events;
    if (!first || !second) throw new Error('Série incompleta.');
    expect(first.seriesId).not.toBeNull();
    expect(new Set(events.map(({ seriesId }) => seriesId)).size).toBe(1);
    expect(new Set(events.map(({ id }) => id)).size).toBe(4);
    for (const [index, event] of events.entries()) {
      expect(event.startsAt.getTime() - first.startsAt.getTime()).toBe(index * 7 * 24 * HOUR);
      expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(HOUR);
      expect(await reminders(event.id)).toHaveLength(1);
    }
    expect(await notifications(student.id, 'event.created', first.id)).toBe(1);
    expect(await notifications(student.id, 'event.created', second.id)).toBe(0);

    const edited = await updateEvent(db, admin.id, second.id, { title: 'Só a segunda semana' });
    expect(edited.title).toBe('Só a segunda semana');
    expect((await readEvent(db, admin.id, first.id)).title).toBe('Live de abertura');
    await deleteEvent(db, admin.id, second.id);
    await expect(readEvent(db, admin.id, second.id)).rejects.toMatchObject({ status: 404 });
    expect(await reminders(second.id)).toHaveLength(0);
    expect((await readEvent(db, admin.id, first.id)).seriesId).toBe(first.seriesId);
    const page = await listEvents(db, admin.id, {
      from: first.startsAt,
      to: new Date(first.startsAt.getTime() + 30 * 24 * HOUR),
      limit: 2,
    });
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).not.toBeNull();
    const rest = await listEvents(db, admin.id, {
      from: first.startsAt,
      to: new Date(first.startsAt.getTime() + 30 * 24 * HOUR),
      limit: 2,
      cursor: page.nextCursor,
    });
    expect([...page.items, ...rest.items].map(({ id }) => id)).toContain(first.id);
  });

  it('agenda o lembrete 30 min antes, refaz ao mudar o horário e avisa só o público atual', async () => {
    const holder = await user();
    const lost = await user();
    const outsider = await user();
    const { course } = await paidCourse();
    await grant(holder.id, course.id);
    const lostGrant = await grant(lost.id, course.id);
    const event = await one(admin.id, {
      ...base(3 * HOUR),
      audience: 'product',
      products: [{ productType: 'course', productId: course.id }],
    });
    const [job] = await reminders(event.id);
    expect(job).toMatchObject({
      uniqueKey: eventReminderKey(event.id, event.startsAt),
      status: 'queued',
      maxAttempts: 3,
    });
    expect(job?.runAt.getTime()).toBe(event.startsAt.getTime() - EVENT_REMINDER_LEAD_MS);
    const oldPayload = { eventId: event.id, startsAt: event.startsAt.toISOString() };

    const startsAt = new Date(Date.now() + 5 * HOUR);
    const moved = await updateEvent(db, admin.id, event.id, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * HOUR),
    });
    const rescheduled = await reminders(event.id);
    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]?.uniqueKey).toBe(eventReminderKey(event.id, moved.startsAt));
    expect(rescheduled[0]?.runAt.getTime()).toBe(startsAt.getTime() - EVENT_REMINDER_LEAD_MS);
    await expect(
      updateEvent(db, admin.id, event.id, { endsAt: new Date(startsAt.getTime() - 1) }),
    ).rejects.toMatchObject({ code: 'event_time_invalid' });
    await expect(updateEvent(db, admin.id, event.id, {})).rejects.toMatchObject({
      code: 'event_patch_empty',
    });

    // Lembrete do horário antigo que ainda rodasse é descartado.
    expect(await sendEventReminder(db, oldPayload)).toEqual({
      notified: 0,
      skipped: 'rescheduled',
    });
    await db
      .updateTable('entitlements')
      .set({ revokedAt: new Date(), revokeReason: 'manual' })
      .where('id', '=', lostGrant.id)
      .execute();
    const payload = { eventId: event.id, startsAt: moved.startsAt.toISOString() };
    expect(await sendEventReminder(db, payload)).toEqual({ notified: 1, skipped: null });
    expect(await notifications(holder.id, 'event.reminder', event.id)).toBe(1);
    expect(await notifications(lost.id, 'event.reminder', event.id)).toBe(0);
    expect(await notifications(outsider.id, 'event.reminder', event.id)).toBe(0);

    // Mudar o público troca os produtos; voltar para all os limpa.
    const reopened = await updateEvent(db, admin.id, event.id, { audience: 'all' });
    expect(reopened.products).toEqual([]);
    const narrowed = await updateEvent(db, admin.id, event.id, {
      audience: 'product',
      products: [{ productType: 'course', productId: course.id }],
    });
    expect(narrowed.products).toHaveLength(1);

    // Atraso: lembrete que chega depois do início não sai.
    await shift(event.id, -5 * MINUTE);
    const started = await readEvent(db, admin.id, event.id);
    expect(
      await sendEventReminder(db, { eventId: event.id, startsAt: started.startsAt.toISOString() }),
    ).toEqual({ notified: 0, skipped: 'already_started' });
    expect(await sendEventReminder(db, { ...payload, eventId: randomUUID() })).toEqual({
      notified: 0,
      skipped: 'event_not_found',
    });

    const audit = await db
      .selectFrom('auditLog')
      .select(['action', 'details'])
      .where('targetId', '=', event.id)
      .orderBy('createdAt')
      .execute();
    expect(audit.map(({ action }) => action)).toEqual([
      'event.create',
      'event.update',
      'event.update',
      'event.update',
    ]);
    expect(JSON.stringify(audit)).not.toContain('sala-secreta');
  });

  it('cancelar avisa o público uma vez, tira o lembrete e fecha o link', async () => {
    const student = await user();
    const event = await one(admin.id, base(10 * MINUTE));
    expect(await reminders(event.id)).toHaveLength(1);
    const canceled = await cancelEvent(db, manager.id, event.id);
    expect(canceled).toMatchObject({ status: 'canceled' });
    expect(canceled.canceledAt).not.toBeNull();
    expect(await reminders(event.id)).toHaveLength(0);
    expect(await notifications(student.id, 'event.canceled', event.id)).toBe(1);
    await cancelEvent(db, manager.id, event.id);
    expect(await notifications(student.id, 'event.canceled', event.id)).toBe(1);
    await expect(joinEvent(db, student.id, event.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateEvent(db, admin.id, event.id, { title: 'Volta' })).rejects.toMatchObject({
      status: 409,
      code: 'event_canceled',
    });
    expect(
      await sendEventReminder(db, { eventId: event.id, startsAt: event.startsAt.toISOString() }),
    ).toEqual({ notified: 0, skipped: 'event_canceled' });
    // Riscado na agenda até a data; some depois dela.
    const range = { from: new Date(Date.now() - 3 * HOUR), to: new Date(Date.now() + HOUR) };
    const agenda = await listEventAgenda(db, student.id, range);
    expect(agenda.items.find(({ id }) => id === event.id)?.status).toBe('canceled');
    await shift(event.id, -2 * HOUR);
    const later = await listEventAgenda(db, student.id, range);
    expect(later.items.find(({ id }) => id === event.id)).toBeUndefined();
    expect(
      (
        await db
          .selectFrom('auditLog')
          .select('action')
          .where('targetId', '=', event.id)
          .where('action', '=', 'event.cancel')
          .execute()
      ).length,
    ).toBe(1);
  });
});

describe('equipe e gravações', () => {
  it('instrutor só gere eventos dos próprios cursos', async () => {
    const instructor = await user('instructor', 'Instrutora');
    const own = await paidCourse(instructor);
    const foreign = await paidCourse();
    await expect(createEvent(db, instructor.id, base(HOUR))).rejects.toMatchObject({ status: 403 });
    await expect(
      createEvent(db, instructor.id, base(HOUR, { courseId: foreign.course.id })),
    ).rejects.toMatchObject({ status: 403 });
    const mine = await one(instructor.id, base(HOUR, { courseId: own.course.id }));
    const theirs = await one(manager.id, base(HOUR, { courseId: foreign.course.id }));
    const general = await one(manager.id, base(HOUR));
    const listed = await listEvents(db, instructor.id);
    expect(listed.items.map(({ id }) => id)).toEqual([mine.id]);
    for (const hidden of [theirs.id, general.id]) {
      await expect(readEvent(db, instructor.id, hidden)).rejects.toMatchObject({ status: 404 });
      await expect(
        updateEvent(db, instructor.id, hidden, { title: 'Meu agora' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(cancelEvent(db, instructor.id, hidden)).rejects.toMatchObject({ status: 404 });
      await expect(deleteEvent(db, instructor.id, hidden)).rejects.toMatchObject({ status: 404 });
    }
    await expect(
      updateEvent(db, instructor.id, mine.id, { courseId: foreign.course.id }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(updateEvent(db, instructor.id, mine.id, { courseId: null })).rejects.toMatchObject(
      { status: 403 },
    );
    expect((await updateEvent(db, instructor.id, mine.id, { kind: 'workshop' })).kind).toBe(
      'workshop',
    );
    const byCourse = await listEvents(db, manager.id, { courseId: own.course.id });
    expect(byCourse.items.map(({ id }) => id)).toEqual([mine.id]);
    await expect(listEvents(db, manager.id, { from: 'ontem' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('evento passado com gravação aparece na aba e leva à aula', async () => {
    const student = await user();
    const { course, lesson } = await paidCourse();
    const past = await one(admin.id, base(-3 * HOUR, { recordingLessonId: lesson.id }));
    const upcoming = await one(admin.id, base(HOUR, { recordingLessonId: lesson.id }));
    const plain = await one(admin.id, base(-3 * HOUR));
    // Evento já encerrado nasce sem aviso e sem lembrete.
    expect(await notifications(student.id, 'event.created', past.id)).toBe(0);
    expect(await reminders(past.id)).toHaveLength(0);

    const recordings = await listEventRecordings(db, student.id, { limit: 100 });
    const ids = recordings.items.map(({ id }) => id);
    expect(ids).toContain(past.id);
    expect(ids).not.toContain(upcoming.id);
    expect(ids).not.toContain(plain.id);
    const item = recordings.items.find(({ id }) => id === past.id);
    expect(item).toMatchObject({ status: 'past', hasRecording: true });
    expect(item?.recording).toEqual({
      lessonId: lesson.id,
      lessonTitle: 'Gravação da live',
      courseId: course.id,
      courseTitle: course.title,
      url: `/meus-cursos/${course.slug}/aulas/${lesson.id}`,
    });
    expect((await getEventView(db, student.id, past.id)).recording?.lessonId).toBe(lesson.id);
    const first = await listEventRecordings(db, student.id, { limit: 1 });
    expect(first.items).toHaveLength(1);

    const linked = await updateEvent(db, admin.id, plain.id, { recordingLessonId: lesson.id });
    expect(linked.recordingLessonId).toBe(lesson.id);
    await cancelEvent(db, admin.id, past.id);
    const after = await listEventRecordings(db, student.id, { limit: 100 });
    expect(after.items.map(({ id }) => id)).not.toContain(past.id);
    expect(after.items.map(({ id }) => id)).toContain(plain.id);
    // Cancelar evento passado não avisa ninguém.
    expect(await notifications(student.id, 'event.canceled', past.id)).toBe(0);
  });
});
