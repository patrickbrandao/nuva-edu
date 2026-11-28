import type { AdminSchemas } from '@nuva-edu/api-client/admin';

export const CATEGORY_ID = '0193a5b2-0000-7000-8000-0000000000f1';
export const TOPIC_ID = '0193a5b2-0000-7000-8000-0000000000f2';
export const POST_ID = '0193a5b2-0000-7000-8000-0000000000f3';
export const AUTHOR_ID = '0193a5b2-0000-7000-8000-0000000000f4';

/** Categoria `ForumCategory` livre, como a API devolve. */
export function forumCategory(
  overrides: Partial<AdminSchemas['ForumCategory']> = {},
): AdminSchemas['ForumCategory'] {
  return {
    id: CATEGORY_ID,
    kind: 'free',
    courseId: null,
    audience: 'all',
    name: 'Bate-papo',
    description: null,
    position: 0,
    archivedAt: null,
    ...overrides,
  };
}

/** Resumo `ForumTopicSummary` de um tópico livre aberto. */
export function forumTopic(
  overrides: Partial<AdminSchemas['ForumTopicSummary']> = {},
): AdminSchemas['ForumTopicSummary'] {
  return {
    id: TOPIC_ID,
    categoryId: CATEGORY_ID,
    lessonId: null,
    author: { id: AUTHOR_ID, displayName: 'Bia Aluna' },
    title: 'Dúvida sobre o módulo 2',
    status: 'open',
    pinned: false,
    solutionPostId: null,
    postsCount: 1,
    lastActivityAt: '2026-11-26T12:00:00Z',
    following: false,
    ...overrides,
  };
}

/** Detalhe `ForumTopicDetail` do tópico. */
export function forumTopicDetail(
  topic: Partial<AdminSchemas['ForumTopicSummary']> = {},
): AdminSchemas['ForumTopicDetail'] {
  return {
    topic: forumTopic(topic),
    bodyHtml: '<p>Corpo do tópico</p>',
    createdAt: '2026-11-26T11:00:00Z',
    editedAt: null,
    deletedAt: null,
    hiddenAt: null,
    moderatedAt: null,
    reactions: [],
    canWrite: true,
  };
}

/** Resposta `ForumPost` do tópico. */
export function forumPost(
  overrides: Partial<AdminSchemas['ForumPost']> = {},
): AdminSchemas['ForumPost'] {
  return {
    id: POST_ID,
    topicId: TOPIC_ID,
    parentPostId: null,
    author: { id: AUTHOR_ID, displayName: 'Caio Colega' },
    bodyHtml: '<p>Uma resposta</p>',
    createdAt: '2026-11-26T12:00:00Z',
    editedAt: null,
    deletedAt: null,
    hiddenAt: null,
    moderatedAt: null,
    reactions: [],
    ...overrides,
  };
}

/** Item agrupado `ModerationQueueItem` da fila. */
export function queueItem(
  overrides: Partial<AdminSchemas['ModerationQueueItem']> = {},
): AdminSchemas['ModerationQueueItem'] {
  return {
    targetType: 'forum_post',
    targetId: POST_ID,
    topicId: TOPIC_ID,
    categoryId: CATEGORY_ID,
    author: { id: AUTHOR_ID, displayName: 'Caio Colega' },
    title: 'Dúvida sobre o módulo 2',
    hidden: false,
    reporterCount: 2,
    firstReportedAt: '2026-11-26T13:00:00Z',
    ...overrides,
  };
}

/** Registro `ForumModerationRecord` do histórico. */
export function moderationRecord(
  overrides: Partial<AdminSchemas['ForumModerationRecord']> = {},
): AdminSchemas['ForumModerationRecord'] {
  return {
    id: '0193a5b2-0000-7000-8000-0000000000f9',
    action: 'warn',
    targetType: 'user',
    targetId: AUTHOR_ID,
    userId: AUTHOR_ID,
    moderator: { id: null, displayName: 'Gil Gerente' },
    reason: 'Linguagem ofensiva',
    createdAt: '2026-11-20T10:00:00Z',
    ...overrides,
  };
}

/** Caso `ModerationQueueDetail` com dois denunciantes. */
export function queueDetail(
  item: Partial<AdminSchemas['ModerationQueueItem']> = {},
  history: AdminSchemas['ForumModerationRecord'][] = [],
): AdminSchemas['ModerationQueueDetail'] {
  return {
    item: queueItem(item),
    bodyHtml: '<p>Texto denunciado</p>',
    reports: [
      {
        id: '0193a5b2-0000-7000-8000-0000000000e1',
        reporter: { id: '0193a5b2-0000-7000-8000-0000000000e2', displayName: 'Dora Denunciante' },
        reason: 'spam',
        details: null,
        status: 'open',
        createdAt: '2026-11-26T13:00:00Z',
      },
      {
        id: '0193a5b2-0000-7000-8000-0000000000e3',
        reporter: { id: '0193a5b2-0000-7000-8000-0000000000e4', displayName: 'Enzo Estudante' },
        reason: 'harassment',
        details: 'Ofendeu um colega',
        status: 'open',
        createdAt: '2026-11-26T14:00:00Z',
      },
    ],
    history,
  };
}
