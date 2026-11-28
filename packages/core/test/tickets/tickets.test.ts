import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  autocloseResolvedTickets,
  type CatalogRequest,
  closeDatabase,
  createCourse,
  createDatabase,
  createLesson,
  createModule,
  type Database,
  enqueueTicketAutoclose,
  listMyTickets,
  listTickets,
  maySettleTicketKind,
  openTicket,
  publishCourse,
  type Role,
  readMyTicket,
  readTicket,
  replyToMyTicket,
  replyToTicket,
  reportBrokenLink,
  resolveMyTicket,
  TICKET_AUTOCLOSE_SETTING_KEY,
  ticketAutocloseDays,
  updateTicket,
} from '../../src/index.ts';

let db: Database;
let admin: { id: string };
let manager: { id: string };
let adminRequest: CatalogRequest;

async function user(role: Role = 'student', name = 'Aluna') {
  return db
    .insertInto('users')
    .values({
      name,
      email: `ticket-${randomUUID()}@example.test`,
      role,
      emailVerifiedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

async function notifications(userId: string, type: string, ticketId: string) {
  const rows = await db
    .selectFrom('jobs')
    .select('id')
    .where('type', '=', 'notify')
    .where(sql<boolean>`payload->>'userId' = ${userId}`)
    .where(sql<boolean>`payload->>'type' = ${type}`)
    .where(sql<boolean>`payload->>'targetId' = ${ticketId}`)
    .execute();
  return rows.length;
}

async function audits(action: string, ticketId: string, outcome = 'ok') {
  return db
    .selectFrom('auditLog')
    .select(['actorUserId', 'origin', 'details'])
    .where('action', '=', action)
    .where('targetId', '=', ticketId)
    .where('outcome', '=', outcome)
    .execute();
}

async function publishedLesson(owner?: { id: string }) {
  const request = adminRequest;
  const course = await createCourse(db, request, {
    title: `Curso ${randomUUID()}`,
    accessMode: 'open',
  });
  const module = await createModule(db, request, course.id, { title: 'Módulo' });
  const lesson = await createLesson(db, request, module.id, {
    title: 'Aula com vídeo',
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

function question(subject = 'Dúvida sobre o curso') {
  return { kind: 'question', subject, bodyMd: 'Como **faço** para começar?' };
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

describe('abertura e conversa', () => {
  it('aluno sem compra abre, acompanha e conversa; nota interna não sai pelo classroom', async () => {
    const student = await user();
    const other = await user();
    const ticket = await openTicket(db, student.id, question());
    expect(ticket).toMatchObject({
      kind: 'question',
      status: 'open',
      relation: 'owner',
      reportsCount: 1,
    });
    expect(ticket.number).toBeGreaterThan(0);
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]?.bodyHtml).toContain('<strong>faço</strong>');
    expect(await notifications(admin.id, 'ticket.opened', ticket.id)).toBe(1);
    expect(await notifications(manager.id, 'ticket.opened', ticket.id)).toBe(1);
    expect(await audits('ticket.open', ticket.id)).toHaveLength(1);

    expect((await listMyTickets(db, student.id)).items.map(({ id }) => id)).toEqual([ticket.id]);
    expect((await listMyTickets(db, other.id)).items).toEqual([]);
    await expect(readMyTicket(db, other.id, ticket.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      replyToMyTicket(db, other.id, ticket.id, { bodyMd: 'Intruso' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(readMyTicket(db, student.id, 'nao-e-uuid')).rejects.toMatchObject({ status: 404 });

    await replyToTicket(db, manager.id, ticket.id, { bodyMd: 'Segredo da equipe', internal: true });
    expect((await readMyTicket(db, student.id, ticket.id)).status).toBe('open');
    expect(await notifications(student.id, 'ticket.reply', ticket.id)).toBe(0);

    const reply = await replyToTicket(db, manager.id, ticket.id, {
      bodyMd: 'Olá! Veja o módulo 1.',
    });
    expect(reply).toMatchObject({ fromStaff: true, internal: false });
    expect(await notifications(student.id, 'ticket.reply', ticket.id)).toBe(1);
    expect(await audits('ticket.reply', ticket.id)).toHaveLength(2);

    const seen = await readMyTicket(db, student.id, ticket.id);
    expect(seen.status).toBe('pending');
    expect(seen.messages.map(({ bodyMd }) => bodyMd)).toEqual([
      'Como **faço** para começar?',
      'Olá! Veja o módulo 1.',
    ]);
    expect(JSON.stringify(seen)).not.toContain('Segredo da equipe');
    expect(seen.messages.every(({ internal }) => !internal)).toBe(true);

    const detail = await readTicket(db, manager.id, ticket.id);
    expect(detail.messages).toHaveLength(3);
    expect(detail.messages[1]).toMatchObject({ internal: true, fromStaff: true });
    expect(detail.user.displayName).toBe('Aluna');
    expect(detail.userContext.account).toMatchObject({ role: 'student', emailVerified: true });
    expect(JSON.stringify(detail)).not.toContain('password');

    // Atribuição: a resposta do aluno passa a avisar só o responsável.
    const assigned = await updateTicket(db, admin.id, ticket.id, { assigneeId: manager.id });
    expect(assigned.assignee).toEqual({ id: manager.id, displayName: 'Gerente' });
    expect(await audits('ticket.assign', ticket.id)).toHaveLength(1);
    expect(await notifications(manager.id, 'ticket.opened', ticket.id)).toBe(2);
    const before = await notifications(admin.id, 'ticket.user_reply', ticket.id);
    await replyToMyTicket(db, student.id, ticket.id, { bodyMd: 'Obrigada, mas não achei.' });
    expect(await notifications(manager.id, 'ticket.user_reply', ticket.id)).toBe(1);
    expect(await notifications(admin.id, 'ticket.user_reply', ticket.id)).toBe(before);
    expect((await readMyTicket(db, student.id, ticket.id)).status).toBe('open');

    const closed = await updateTicket(db, manager.id, ticket.id, { status: 'closed' });
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).not.toBeNull();
    expect(await notifications(student.id, 'ticket.status_changed', ticket.id)).toBe(1);
    await expect(
      replyToMyTicket(db, student.id, ticket.id, { bodyMd: 'Ainda aí?' }),
    ).rejects.toMatchObject({ status: 409, code: 'ticket_closed' });
    await expect(
      replyToTicket(db, manager.id, ticket.id, { bodyMd: 'Tarde demais' }),
    ).rejects.toMatchObject({ status: 409, code: 'ticket_closed' });
    await expect(resolveMyTicket(db, student.id, ticket.id)).rejects.toMatchObject({
      code: 'ticket_closed',
    });
    await expect(updateTicket(db, admin.id, ticket.id, { status: 'open' })).rejects.toMatchObject({
      code: 'ticket_closed',
    });
    await replyToTicket(db, manager.id, ticket.id, {
      bodyMd: 'Nota pós-fechamento',
      internal: true,
    });
  });

  it('valida tipo, assunto, texto e vínculos', async () => {
    const student = await user();
    const other = await user();
    await expect(openTicket(db, student.id, { ...question(), kind: 'spam' })).rejects.toMatchObject(
      { code: 'ticket_kind_invalid' },
    );
    await expect(openTicket(db, student.id, question('Oi'))).rejects.toMatchObject({
      code: 'ticket_subject_invalid',
    });
    await expect(openTicket(db, student.id, question('a'.repeat(151)))).rejects.toMatchObject({
      code: 'ticket_subject_invalid',
    });
    await expect(
      openTicket(db, student.id, { ...question(), bodyMd: 'x'.repeat(10_001) }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      openTicket(db, student.id, { ...question(), bodyMd: '   ' }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      openTicket(db, student.id, { ...question(), courseId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'ticket_link_invalid' });
    await expect(
      openTicket(db, student.id, { ...question(), orderId: 'abc' }),
    ).rejects.toMatchObject({ code: 'ticket_link_invalid' });

    const { course, lesson } = await publishedLesson();
    const order = await db
      .insertInto('orders')
      .values({
        userId: other.id,
        buyerName: 'Outra',
        buyerTaxId: '00000000000',
        buyerTaxIdType: 'cpf',
        currency: 'BRL',
        subtotalCents: 100,
        totalCents: 100,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(
      openTicket(db, student.id, { ...question(), kind: 'payment', orderId: order.id }),
    ).rejects.toMatchObject({ code: 'ticket_link_invalid' });
    const own = await openTicket(db, other.id, {
      ...question(),
      kind: 'payment',
      orderId: order.id,
    });
    expect(own.orderId).toBe(order.id);
    expect((await readTicket(db, admin.id, own.id)).userContext.recentOrders).toHaveLength(1);

    await expect(
      openTicket(db, student.id, { ...question(), lessonId: lesson.id, courseId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'ticket_link_invalid' });
    const linked = await openTicket(db, student.id, { ...question(), lessonId: lesson.id });
    expect(linked).toMatchObject({ lessonId: lesson.id, courseId: course.id });
    await expect(updateTicket(db, admin.id, linked.id, {})).rejects.toMatchObject({
      code: 'ticket_patch_empty',
    });
    await expect(updateTicket(db, admin.id, linked.id, { status: 'done' })).rejects.toMatchObject({
      code: 'ticket_status_invalid',
    });
    await expect(
      updateTicket(db, admin.id, linked.id, { assigneeId: student.id }),
    ).rejects.toMatchObject({ code: 'ticket_assignee_invalid' });
    await expect(listTickets(db, admin.id, { status: 'x', kind: 'y' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(listTickets(db, student.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe('link quebrado', () => {
  it('dois relatos do mesmo link viram um chamado com contador 2, sem vazar mensagens', async () => {
    const first = await user('student', 'Primeira');
    const second = await user('student', 'Segundo');
    const { course, lesson } = await publishedLesson();

    const opened = await reportBrokenLink(db, first.id, { lessonId: lesson.id });
    expect(opened.merged).toBe(false);
    expect(opened.ticket).toMatchObject({
      kind: 'broken_link',
      lessonId: lesson.id,
      courseId: course.id,
      relation: 'owner',
    });
    const mine = await readMyTicket(db, first.id, opened.ticket.id);
    expect(mine.messages[0]?.bodyMd).toContain('https://www.youtube.com/watch?v=abcdefghijk');

    const again = await reportBrokenLink(db, first.id, { lessonId: lesson.id });
    expect(again).toMatchObject({
      merged: true,
      ticket: { id: opened.ticket.id, reportsCount: 1 },
    });

    const merged = await reportBrokenLink(
      db,
      second.id,
      { lessonId: lesson.id },
      { note: 'Comigo também falha.' },
    );
    expect(merged).toMatchObject({
      merged: true,
      ticket: { id: opened.ticket.id, reportsCount: 2, relation: 'follower' },
    });
    const repeated = await reportBrokenLink(db, second.id, { lessonId: lesson.id });
    expect(repeated.ticket.reportsCount).toBe(2);
    expect(
      await db
        .selectFrom('tickets')
        .select('id')
        .where('lessonId', '=', lesson.id)
        .where('kind', '=', 'broken_link')
        .execute(),
    ).toHaveLength(1);

    await replyToTicket(db, manager.id, opened.ticket.id, { bodyMd: 'Estamos corrigindo.' });
    const follower = await readMyTicket(db, second.id, opened.ticket.id);
    expect(follower.messages.map(({ bodyMd }) => bodyMd)).toEqual(['Comigo também falha.']);
    const owner = await readMyTicket(db, first.id, opened.ticket.id);
    expect(owner.messages).toHaveLength(2);
    expect(JSON.stringify(owner)).not.toContain('Comigo também falha.');
    expect((await listMyTickets(db, second.id)).items[0]?.relation).toBe('follower');
    await expect(
      replyToMyTicket(db, second.id, opened.ticket.id, { bodyMd: 'E aí?' }),
    ).rejects.toMatchObject({ status: 403 });

    const staff = await readTicket(db, manager.id, opened.ticket.id);
    expect(staff.followers).toEqual([{ id: second.id, displayName: 'Segundo' }]);
    expect(staff.messages).toHaveLength(3);
    expect(staff.messages.find(({ bodyMd }) => bodyMd === 'Comigo também falha.')?.fromStaff).toBe(
      false,
    );

    await updateTicket(db, manager.id, opened.ticket.id, { status: 'resolved' });
    expect(await notifications(second.id, 'ticket.status_changed', opened.ticket.id)).toBe(1);
    // Resolvido: o próximo relato abre um chamado novo.
    const fresh = await reportBrokenLink(db, second.id, { lessonId: lesson.id });
    expect(fresh.merged).toBe(false);
    expect(fresh.ticket.id).not.toBe(opened.ticket.id);
  });

  it('exige o acesso do conteúdo e cobre o ebook', async () => {
    const student = await user();
    await expect(
      reportBrokenLink(db, student.id, { lessonId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    const ebook = await db
      .insertInto('ebooks')
      .values({
        title: 'Guia aberto',
        slug: `guia-${randomUUID()}`,
        accessMode: 'open',
        status: 'published',
        publishedAt: new Date(),
        fileUrl: 'https://files.example.test/guia.pdf',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const report = await reportBrokenLink(db, student.id, { ebookId: ebook.id });
    expect(report.ticket).toMatchObject({
      ebookId: ebook.id,
      subject: 'Link quebrado: Guia aberto',
    });
    const paid = await db
      .insertInto('ebooks')
      .values({
        title: 'Guia pago',
        slug: `pago-${randomUUID()}`,
        accessMode: 'paid',
        priceCents: 1000,
        status: 'published',
        publishedAt: new Date(),
        fileUrl: 'https://files.example.test/pago.pdf',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(reportBrokenLink(db, student.id, { ebookId: paid.id })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('escopo por papel', () => {
  it('refund e privacy só o admin resolve; o aluno resolve o próprio', async () => {
    expect(maySettleTicketKind('manager', 'refund')).toBe(false);
    expect(maySettleTicketKind('admin', 'privacy')).toBe(true);
    expect(maySettleTicketKind('instructor', 'question')).toBe(true);
    expect(maySettleTicketKind('instructor', 'payment')).toBe(false);
    expect(maySettleTicketKind('student', 'question')).toBe(false);
    const student = await user();
    const ticket = await openTicket(db, student.id, {
      kind: 'refund',
      subject: 'Quero reembolso',
      bodyMd: 'Comprei errado.',
    });
    await expect(
      updateTicket(db, manager.id, ticket.id, { status: 'resolved' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateTicket(db, manager.id, ticket.id, { status: 'closed' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateTicket(db, manager.id, ticket.id, { kind: 'question' }),
    ).rejects.toMatchObject({ status: 403 });
    const denied = await audits('ticket.set_status', ticket.id, 'denied');
    expect(denied).toHaveLength(3);
    expect(denied[0]).toMatchObject({ actorUserId: manager.id });
    expect((await readTicket(db, manager.id, ticket.id)).status).toBe('open');
    // O gerente ainda responde e muda para pendente.
    await replyToTicket(db, manager.id, ticket.id, { bodyMd: 'Encaminhei ao admin.' });
    const resolved = await updateTicket(db, admin.id, ticket.id, { status: 'resolved' });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await audits('ticket.set_status', ticket.id)).toHaveLength(1);
    await expect(
      updateTicket(db, admin.id, ticket.id, { status: 'pending' }),
    ).rejects.toMatchObject({ code: 'ticket_transition_invalid' });

    const privacy = await openTicket(db, student.id, {
      kind: 'privacy',
      subject: 'Meus dados pessoais',
      bodyMd: 'Quero saber o que vocês guardam.',
    });
    const mine = await resolveMyTicket(db, student.id, privacy.id);
    expect(mine.status).toBe('resolved');
    expect((await resolveMyTicket(db, student.id, privacy.id)).status).toBe('resolved');
    const trail = await audits('ticket.set_status', privacy.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ origin: 'classroom', actorUserId: student.id });
  });

  it('instrutor só enxerga e atende chamados de conteúdo dos próprios cursos', async () => {
    const instructor = await user('instructor', 'Instrutora');
    const student = await user();
    const own = await publishedLesson(instructor);
    const foreign = await publishedLesson();
    const content = await openTicket(db, student.id, { ...question(), courseId: own.course.id });
    const broken = await reportBrokenLink(db, student.id, { lessonId: own.lesson.id });
    const payment = await openTicket(db, student.id, {
      ...question(),
      kind: 'payment',
      courseId: own.course.id,
    });
    const elsewhere = await openTicket(db, student.id, {
      ...question(),
      courseId: foreign.course.id,
    });
    const loose = await openTicket(db, student.id, question());

    const listed = await listTickets(db, instructor.id);
    expect(listed.items.map(({ id }) => id).sort()).toEqual([content.id, broken.ticket.id].sort());
    for (const hidden of [payment.id, elsewhere.id, loose.id]) {
      await expect(readTicket(db, instructor.id, hidden)).rejects.toMatchObject({ status: 404 });
      await expect(
        replyToTicket(db, instructor.id, hidden, { bodyMd: 'Oi' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        updateTicket(db, instructor.id, hidden, { status: 'resolved' }),
      ).rejects.toMatchObject({ status: 404 });
    }
    const detail = await readTicket(db, instructor.id, content.id);
    expect(detail.userContext.account).toBeNull();
    expect(detail.userContext.recentOrders).toEqual([]);
    expect(detail.course).toEqual({ id: own.course.id, title: own.course.title });
    await replyToTicket(db, instructor.id, content.id, { bodyMd: 'Respondo já.' });
    await expect(
      updateTicket(db, instructor.id, content.id, { kind: 'payment' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateTicket(db, instructor.id, content.id, { assigneeId: manager.id }),
    ).rejects.toMatchObject({ status: 403 });
    const taken = await updateTicket(db, instructor.id, content.id, {
      assigneeId: instructor.id,
      kind: 'suggestion',
      status: 'resolved',
    });
    expect(taken).toMatchObject({ kind: 'suggestion', status: 'resolved' });
    expect(taken.assignee?.id).toBe(instructor.id);
    // Instrutor fora do escopo não pode ser responsável.
    await expect(
      updateTicket(db, admin.id, elsewhere.id, { assigneeId: instructor.id }),
    ).rejects.toMatchObject({ code: 'ticket_assignee_invalid' });

    // Filtros da equipe (RF-07) e paginação por espera.
    const byCourse = await listTickets(db, manager.id, { courseId: own.course.id });
    expect(byCourse.items).toHaveLength(3);
    const byKind = await listTickets(db, manager.id, { courseId: own.course.id, kind: 'payment' });
    expect(byKind.items.map(({ id }) => id)).toEqual([payment.id]);
    const byAssignee = await listTickets(db, manager.id, { assigneeId: instructor.id });
    expect(byAssignee.items.map(({ id }) => id)).toEqual([content.id]);
    const unassigned = await listTickets(db, manager.id, {
      courseId: own.course.id,
      assigneeId: 'none',
      status: 'open',
    });
    expect(unassigned.items).toHaveLength(2);
    const page = await listTickets(db, manager.id, { courseId: own.course.id, limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const rest = await listTickets(db, manager.id, {
      courseId: own.course.id,
      limit: 2,
      cursor: page.nextCursor,
    });
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    const waits = [...page.items, ...rest.items].map(({ lastUserMessageAt }) =>
      lastUserMessageAt.getTime(),
    );
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
  });
});

describe('limites e fechamento', () => {
  it('sexto chamado do dia e 31ª mensagem da hora recebem 429', async () => {
    const student = await user();
    let last = '';
    for (let index = 0; index < 5; index += 1) {
      last = (await openTicket(db, student.id, question(`Chamado número ${index}`))).id;
    }
    const error = await openTicket(db, student.id, question()).catch((reason) => reason);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited' });
    expect(error.extras.retryAfterSeconds).toBeGreaterThan(0);
    const { lesson } = await publishedLesson();
    await expect(reportBrokenLink(db, student.id, { lessonId: lesson.id })).rejects.toMatchObject({
      status: 429,
    });

    await db
      .insertInto('ticketMessages')
      .values(
        Array.from({ length: 29 }, () => ({
          ticketId: last,
          authorId: student.id,
          bodyMd: 'x',
          bodyHtml: '<p>x</p>',
        })),
      )
      .execute();
    await expect(
      replyToMyTicket(db, student.id, last, { bodyMd: 'Trigésima primeira' }),
    ).rejects.toMatchObject({ status: 429 });
    // O limite é por autor: a equipe ainda responde.
    await replyToTicket(db, manager.id, last, { bodyMd: 'Recebido.' });
  });

  it('resolved vencido é fechado pela tarefa diária; a resposta no prazo reabre', async () => {
    const student = await user();
    const expired = await openTicket(db, student.id, question('Chamado vencido'));
    const recent = await openTicket(db, student.id, question('Chamado recente'));
    const answered = await openTicket(db, student.id, question('Chamado respondido'));
    for (const { id } of [expired, recent, answered]) {
      await updateTicket(db, manager.id, id, { status: 'resolved' });
    }
    const backdate = (id: string, days: number) =>
      db
        .updateTable('tickets')
        .set({ resolvedAt: sql<Date>`now() - make_interval(days => ${days})` })
        .where('id', '=', id)
        .execute();
    await backdate(expired.id, 8);
    await backdate(recent.id, 3);
    await backdate(answered.id, 6);
    await replyToMyTicket(db, student.id, answered.id, { bodyMd: 'Voltou a acontecer.' });
    expect(await readMyTicket(db, student.id, answered.id)).toMatchObject({
      status: 'open',
      resolvedAt: null,
    });
    // Vencido, mas a tarefa ainda não rodou: a resposta já é recusada.
    await expect(
      replyToMyTicket(db, student.id, expired.id, { bodyMd: 'Cheguei tarde' }),
    ).rejects.toMatchObject({ code: 'ticket_closed' });

    expect(await ticketAutocloseDays(db)).toBe(7);
    const first = await autocloseResolvedTickets(db, { batchSize: 1 });
    expect(first).toEqual({ closed: 1, days: 7 });
    expect((await readMyTicket(db, student.id, expired.id)).status).toBe('closed');
    expect((await readMyTicket(db, student.id, recent.id)).status).toBe('resolved');
    expect((await readMyTicket(db, student.id, answered.id)).status).toBe('open');
    const trail = await audits('ticket.set_status', expired.id);
    expect(trail.at(-1)).toMatchObject({ origin: 'worker', actorUserId: null });
    expect(await notifications(student.id, 'ticket.status_changed', expired.id)).toBe(2);
    expect((await autocloseResolvedTickets(db)).closed).toBe(0);
    expect(await notifications(student.id, 'ticket.status_changed', expired.id)).toBe(2);

    // Prazo ajustável em settings; sinal já abortado não fecha nada.
    await db
      .insertInto('settings')
      .values({ key: TICKET_AUTOCLOSE_SETTING_KEY, value: JSON.stringify(2) })
      .execute();
    const aborted = new AbortController();
    aborted.abort();
    expect(await autocloseResolvedTickets(db, { signal: aborted.signal })).toEqual({
      closed: 0,
      days: 2,
    });
    expect((await autocloseResolvedTickets(db)).closed).toBe(1);
    expect((await readMyTicket(db, student.id, recent.id)).status).toBe('closed');
    await db.deleteFrom('settings').where('key', '=', TICKET_AUTOCLOSE_SETTING_KEY).execute();
  });

  it('a recorrente ticket.autoclose entra uma vez por janela', async () => {
    const window = `2099-01-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}-${randomUUID()}`;
    const job = await enqueueTicketAutoclose(db, window, new Date(Date.now() + 86_400_000));
    expect(job).toMatchObject({ type: 'ticket.autoclose', maxAttempts: 5 });
    expect(await enqueueTicketAutoclose(db, window)).toBeNull();
    await db
      .deleteFrom('jobs')
      .where('id', '=', job?.id ?? '')
      .execute();
  });
});

describe('suspensão', () => {
  it('full bloqueia abrir, listar, ler e responder; posting não; ao fim o acesso volta', async () => {
    const student = await user();
    const ticket = await openTicket(db, student.id, question());
    const suspend = (kind: 'full' | 'posting' | null) =>
      db
        .updateTable('users')
        .set(
          kind === null
            ? { suspendedKind: null, suspendedAt: null, suspendedBy: null, suspendedReason: null }
            : {
                suspendedKind: kind,
                suspendedAt: new Date(),
                suspendedBy: admin.id,
                suspendedReason: 'Teste',
              },
        )
        .where('id', '=', student.id)
        .execute();

    await suspend('posting');
    await replyToMyTicket(db, student.id, ticket.id, { bodyMd: 'Com posting ainda falo.' });
    await openTicket(db, student.id, question('Outro chamado com posting'));

    await suspend('full');
    const blocked = { status: 401, code: 'unauthenticated' };
    await expect(openTicket(db, student.id, question())).rejects.toMatchObject(blocked);
    await expect(listMyTickets(db, student.id)).rejects.toMatchObject(blocked);
    await expect(readMyTicket(db, student.id, ticket.id)).rejects.toMatchObject(blocked);
    await expect(
      replyToMyTicket(db, student.id, ticket.id, { bodyMd: 'Link do e-mail' }),
    ).rejects.toMatchObject(blocked);
    await expect(resolveMyTicket(db, student.id, ticket.id)).rejects.toMatchObject(blocked);
    await expect(
      reportBrokenLink(db, student.id, { lessonId: randomUUID() }),
    ).rejects.toMatchObject(blocked);
    // A equipe continua atendendo; o aviso ao suspenso é barrado pela central.
    await replyToTicket(db, manager.id, ticket.id, { bodyMd: 'Aguardamos o fim da suspensão.' });

    await suspend(null);
    const back = await readMyTicket(db, student.id, ticket.id);
    expect(back.messages.at(-1)?.bodyMd).toBe('Aguardamos o fim da suspensão.');
    await replyToMyTicket(db, student.id, ticket.id, { bodyMd: 'Voltei.' });
  });
});
