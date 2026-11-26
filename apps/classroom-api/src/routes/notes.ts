import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  assertCan,
  type CreateNoteInput,
  createNote,
  DomainError,
  deleteNote,
  getNote,
  isDomainError,
  type ListNotesQuery,
  listLessonNotes,
  listNotes,
  type NoteOwner,
  type UpdateNoteInput,
  updateNote,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache, viewerOf } from './catalog.ts';
import { bodyOf, paramsOf, type RouteContext } from './context.ts';

/**
 * O dono das notas é sempre o usuário da sessão (spec 016, RF-06). A permissão `learning.track`
 * (spec 008) é conferida aqui, pelo papel; a condição dela (acesso à aula ao criar nota de aula)
 * é do núcleo, por `canAccess`.
 */
function ownerOf(request: FastifyRequest): NoteOwner {
  const viewer = viewerOf(request);
  assertCan(viewer, 'learning.track');
  return { id: viewer.id };
}

/**
 * O `409 version_conflict` do núcleo leva a nota gravada em `extras.current`, com `Date`. O
 * problem+json é conferido contra o contrato antes de virar texto, então `current` sai daqui já
 * no formato do fio (`Note`, datas em ISO 8601).
 */
function conflictToWire(error: unknown): unknown {
  if (
    !isDomainError(error) ||
    error.code !== 'version_conflict' ||
    error.extras?.current === undefined
  ) {
    return error;
  }
  return new DomainError({
    code: error.code,
    status: error.status,
    title: error.title,
    detail: error.detail,
    extras: { ...error.extras, current: toWire(error.extras.current) },
    cause: error,
  });
}

/**
 * Anotações (spec 016): notas de aula e avulsas, privadas do dono. As regras (filtro por dono,
 * direito de acesso ao criar, tetos, controle de versão por `updatedAt`) são do núcleo; a rota
 * só adapta ao contrato. O corpo da requisição nunca vai para o log.
 */
export function registerNotesRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;

  // `GET /notes`: a página "Anotações", com o trecho de cada nota. Parâmetros já validados e com
  // os padrões; cursor fora do formato é `400` do núcleo.
  app.operation('listNotes', async (request, reply) => {
    const page = await listNotes(db, ownerOf(request), request.query as ListNotesQuery);
    privateCache(reply);
    return toWire(page);
  });

  // `POST /notes`: de aula (`lessonId`) ou avulsa. `403 access_denied` com `reason` sem acesso à
  // aula, `404` aula fora do ar, `422` pelos limites. A fração de `videoSeconds` é do núcleo.
  app.operation('createNote', async (request, reply) => {
    const note = await createNote(db, ownerOf(request), bodyOf<CreateNoteInput>(request));
    reply.status(201);
    privateCache(reply);
    return toWire(note);
  });

  // `GET /notes/{id}`: nota alheia ou inexistente é `404`.
  app.operation('getNote', async (request, reply) => {
    const { id } = paramsOf<{ id: string }>(request);
    const note = await getNote(db, ownerOf(request), id);
    privateCache(reply);
    return toWire(note);
  });

  // `PATCH /notes/{id}`: salvamento automático. `updatedAt` desatualizado: `409` com `current`.
  app.operation('updateNote', async (request, reply) => {
    const { id } = paramsOf<{ id: string }>(request);
    try {
      const note = await updateNote(db, ownerOf(request), id, bodyOf<UpdateNoteInput>(request));
      privateCache(reply);
      return toWire(note);
    } catch (error) {
      throw conflictToWire(error);
    }
  });

  // `DELETE /notes/{id}`: definitivo.
  app.operation('deleteNote', async (request, reply) => {
    const { id } = paramsOf<{ id: string }>(request);
    await deleteNote(db, ownerOf(request), id);
    reply.status(204);
  });

  // `GET /lessons/{id}/notes`: a aba "Minhas notas", inteira (até 100), sem exigir acesso à aula.
  app.operation('listLessonNotes', async (request, reply) => {
    const { id } = paramsOf<{ id: string }>(request);
    const items = await listLessonNotes(db, ownerOf(request), id);
    privateCache(reply);
    return toWire({ items });
  });
}
