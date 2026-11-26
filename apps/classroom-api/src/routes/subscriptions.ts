import type { FastifyInstance, FastifyRequest } from '@nuva-edu/api-kit';
import {
  assertCan,
  type CatalogViewer,
  cancelMySubscription,
  createSubscriptionCheckout,
  getMySubscription,
  listMySubscriptions,
  listPublicPlans,
  type MySubscriptionsQuery,
  type PaymentProvider,
  type PaymentReturnUrls,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { privateCache, viewerOf } from './catalog.ts';
import { bodyOf, paramsOf, type RouteContext } from './context.ts';

/**
 * Vitrine de planos e assinatura do aluno (spec 012): o plano, o estado, o período e as
 * cobranças. O núcleo decide tudo — a rota só adapta ao contrato e passa a porta de pagamento
 * (spec 013). Nenhuma regra de direito de acesso é reimplementada aqui.
 */

/** A vitrine é igual para todos e não leva dado de usuário: cache compartilhado com conferência. */
const PUBLIC_CACHE = 'public, no-cache';

/** O aluno da sessão, com a permissão da operação (`x-permission: purchase.create`). */
function studentOf(request: FastifyRequest): CatalogViewer {
  const viewer = viewerOf(request);
  assertCan(viewer, 'purchase.create');
  return viewer;
}

/** Corpo de `POST /subscriptions`, já validado pelo contrato. */
interface CreateSubscriptionBody {
  planId: string;
  couponCode?: string | null;
}

/**
 * O que a rota de assinatura precisa além do contexto comum: a porta de pagamento (spec 013).
 * Ela é resolvida na chamada, não na montagem: o serviço sobe mesmo com o provedor fora.
 */
export interface SubscriptionRouteContext extends RouteContext {
  paymentProvider(): PaymentProvider;
}

/**
 * Para onde o navegador volta do checkout do provedor (spec 012, RF-03 e spec 013): a página da
 * assinatura em "Minha assinatura". As três URLs levam ao mesmo lugar; o estado real vem da API.
 */
export function subscriptionReturnUrls(classroomUrl: string): PaymentReturnUrls {
  const purchases = `${classroomUrl}/conta/compras`;
  return { success: purchases, pending: purchases, failure: purchases };
}

export function registerSubscriptionRoutes(
  app: FastifyInstance,
  ctx: SubscriptionRouteContext,
): void {
  const { config, db } = ctx;

  // `GET /plans`: vitrine agrupada por `groupKey`, sem login (spec 012, "Planos"). Plano inativo
  // não aparece; item não publicado ou `private` é omitido pelo núcleo.
  app.operation('listPlans', async (_request, reply) => {
    const groups = await listPublicPlans(db);
    reply.header('Cache-Control', PUBLIC_CACHE);
    return toWire({ groups, currency: config.currency });
  });

  // `POST /subscriptions`: cria a assinatura em `pending` e a adesão no provedor, e devolve a URL
  // do checkout recorrente. E-mail confirmado, dados de comprador, plano ativo, cupom e
  // duplicidade são decididos pelo núcleo (`createSubscriptionCheckout`).
  app.operation('createSubscription', async (request, reply) => {
    const viewer = studentOf(request);
    const body = bodyOf<CreateSubscriptionBody>(request);
    const checkout = await createSubscriptionCheckout(db, {
      userId: viewer.id,
      planId: body.planId,
      couponCode: body.couponCode ?? null,
      provider: ctx.paymentProvider(),
      currency: config.currency,
      returnUrls: subscriptionReturnUrls(config.classroomUrl),
    });
    reply.status(201);
    privateCache(reply);
    return toWire(checkout);
  });

  // `GET /me/subscriptions`: a atual e o histórico do próprio aluno, filtro por estado e cursor
  // (spec 012, RF-08). O núcleo recusa e-mail não confirmado (`403`).
  app.operation('listMySubscriptions', async (request, reply) => {
    const viewer = studentOf(request);
    const page = await listMySubscriptions(db, viewer.id, request.query as MySubscriptionsQuery);
    privateCache(reply);
    return toWire(page);
  });

  // `GET /me/subscriptions/{id}`: plano, período, carência e cobranças. Assinatura de outra
  // pessoa é `404`, como o núcleo responde.
  app.operation('getMySubscription', async (request, reply) => {
    const viewer = studentOf(request);
    const { id } = paramsOf<{ id: string }>(request);
    const detail = await getMySubscription(db, viewer.id, id);
    privateCache(reply);
    return toWire(detail);
  });

  // `POST /me/subscriptions/{id}/cancel`: `pending` vira `expired` (libera assinar de novo);
  // `active` e `past_due` viram `canceling`; `suspended` e os estados finais respondem `409`.
  // Provedor que não confirma: `503` e nada muda (spec 012, "Cancelamento pelo aluno").
  app.operation('cancelMySubscription', async (request, reply) => {
    const viewer = studentOf(request);
    const { id } = paramsOf<{ id: string }>(request);
    const detail = await cancelMySubscription(db, ctx.paymentProvider(), viewer.id, id);
    privateCache(reply);
    return toWire(detail);
  });
}
