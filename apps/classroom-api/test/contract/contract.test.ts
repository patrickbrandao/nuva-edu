import { formatContractReport, formatSseEvent } from '@nuva-edu/api-kit';
import { USER_EVENT_KINDS, type UserEventKind } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import { CSRF_EXCEPTIONS } from '../../src/contract.ts';
import { PING_FRAME, toStreamEvent } from '../../src/stream/events.ts';
import { createTestApp } from '../helpers.ts';

const USER = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
const OTHER = '0193a5b2-8e2f-7a11-b0c3-5d7e9f1a2b3c';
const DM = { conversationId: USER, messageId: OTHER };

/** Um `data` válido por evento que chega do banco: tipo novo no núcleo não compila sem exemplo. */
const SAMPLE_DATA: Record<UserEventKind, Record<string, unknown>> = {
  'dm.message.created': DM,
  'dm.message.read': DM,
  'dm.message.deleted': DM,
  'notification.created': { notificationId: OTHER, type: 'forum.reply', unreadCount: 3 },
  'forum.post.created': { topicId: USER, postId: OTHER },
  'announcement.published': { announcementId: OTHER, unreadCount: 0 },
  presence: { userId: OTHER, online: true },
};

describe('contrato da classroom-api', () => {
  const test = createTestApp();
  afterAll(() => test.close());

  it('toda rota registrada existe no openapi.yaml e vice-versa, e toda escrita exige csrfToken', () => {
    const report = test.app.checkContract({ csrfExceptions: CSRF_EXCEPTIONS });
    // A mensagem lista cada divergência; vazia quando não há nenhuma.
    expect(formatContractReport(report)).toBe('');
    expect(report.ok).toBe(true);
  });

  it('só /metrics fica fora do contrato', () => {
    const declared = new Set(test.app.contract.operations.map((operation) => operation.routePath));
    const outside = test.app
      .registeredRoutes()
      .filter((route) => !declared.has(route.path))
      .map((route) => `${route.method} ${route.path}`);
    expect(outside).toEqual(['GET /metrics']);
  });

  it('os eventos do fluxo SSE são os do esquema StreamEvent, fora o ping', () => {
    const document = test.app.contract.document as {
      components: {
        schemas: { StreamEvent: { discriminator: { mapping: Record<string, string> } } };
      };
    };
    const declared = Object.keys(document.components.schemas.StreamEvent.discriminator.mapping);
    expect([...USER_EVENT_KINDS, 'ping'].sort()).toEqual(declared.sort());
  });

  it.each(USER_EVENT_KINDS)('o evento %s, como sai no fio, confere com o StreamEvent', (kind) => {
    const validate = test.app.contractSchema('StreamEvent');
    const event = toStreamEvent({ userId: USER, id: 42, event: kind, data: SAMPLE_DATA[kind] });
    expect(validate(event)).toEqual([]);
    // O `id` do contrato é texto; campo a mais ou `data` incompleto é recusado.
    expect(validate({ ...event, id: 42 })).not.toEqual([]);
    expect(validate({ ...event, data: { ...event.data, extra: 1 } })).not.toEqual([]);
    expect(validate({ ...event, data: {} })).not.toEqual([]);
  });

  it('o ping, como sai no fio, confere com o StreamEvent', () => {
    expect(PING_FRAME).toBe(formatSseEvent({ event: 'ping' }));
    expect(PING_FRAME).toBe('event: ping\ndata: {}\n\n');
    expect(test.app.contractSchema('StreamEvent')({ event: 'ping', data: {} })).toEqual([]);
  });

  it('o serviço sobe com o contrato atual', async () => {
    await expect(test.app.ready()).resolves.toBeDefined();
  });
});
