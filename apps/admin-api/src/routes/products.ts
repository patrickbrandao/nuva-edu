import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type AdminBundleDetail,
  type AdminBundleSummary,
  type AdminEbookDetail,
  type AdminEbookSummary,
  archiveBundle,
  archiveEbook,
  createBundle,
  createEbook,
  type Database,
  deleteBundle,
  deleteEbook,
  getAdminBundle,
  getAdminEbook,
  linkEbookTarget,
  listAdminBundles,
  listAdminEbooks,
  publishBundle,
  publishEbook,
  setBundleItems,
  setEbookTargets,
  unarchiveBundle,
  unarchiveEbook,
  unlinkEbookTarget,
  unpublishBundle,
  unpublishEbook,
  updateBundle,
  updateEbook,
} from '@nuva-edu/core';
import {
  catalogRequest,
  coverBody,
  type IdParams,
  iso,
  isoOrNull,
  pick,
} from './catalog-common.ts';

// Ebooks, pacotes, itens do pacote e vínculos do ebook (spec 009; 008, "Regra do instrutor"). O
// tratador de `sessionCookie` confere a ação de `x-permission`; o que depende do alvo (modo de
// acesso, preço, vínculo a curso alheio ao instrutor) fica nas regras do núcleo, que também
// gravam a negação, a auditoria de cada escrita (spec 028) e o `entitlement.recompute` de quem
// muda de composição (spec 010).
//
// Como nas rotas de curso, a resposta é sempre a leitura do editor (`getAdminEbook`,
// `getAdminBundle`), montada campo a campo, com a `version` da edição; a `version` do corpo
// (obrigatória nos `PATCH`, opcional nas trocas de lista) vai ao núcleo como veio.

export interface ProductRoutesOptions {
  db: Database;
}

/** Campos comuns a `EbookSummary` e `BundleSummary`, até `status`. */
function productBody(product: AdminEbookSummary | AdminBundleSummary) {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    summary: product.summary,
    cover: coverBody(product.cover),
    accessMode: product.accessMode,
    priceCents: product.priceCents,
    accessDays: product.accessDays,
    status: product.status,
  };
}

function productDates(product: AdminEbookSummary | AdminBundleSummary) {
  return {
    publishedAt: isoOrNull(product.publishedAt),
    archivedAt: isoOrNull(product.archivedAt),
    createdAt: iso(product.createdAt),
    updatedAt: iso(product.updatedAt),
  };
}

/** `EbookSummary` do contrato. */
function ebookSummaryBody(ebook: AdminEbookSummary) {
  return {
    ...productBody(ebook),
    authorName: ebook.authorName,
    pages: ebook.pages,
    ...productDates(ebook),
  };
}

/** `EbookDetail` do contrato. */
function ebookDetailBody(ebook: AdminEbookDetail) {
  return {
    ...ebookSummaryBody(ebook),
    description: ebook.description,
    fileUrl: ebook.fileUrl,
    version: ebook.version,
    targets: ebook.targets.map((target) => ({
      targetType: target.targetType,
      targetId: target.targetId,
      title: target.title,
      course:
        target.course === null
          ? null
          : { type: target.course.type, id: target.course.id, title: target.course.title },
    })),
    studentCount: ebook.studentCount,
  };
}

/** `BundleSummary` do contrato. */
function bundleSummaryBody(bundle: AdminBundleSummary) {
  return {
    ...productBody(bundle),
    itemCount: bundle.itemCount,
    ...productDates(bundle),
  };
}

/** `BundleDetail` do contrato. */
function bundleDetailBody(bundle: AdminBundleDetail) {
  return {
    ...bundleSummaryBody(bundle),
    description: bundle.description,
    version: bundle.version,
    items: bundle.items.map((item) => ({
      productType: item.productType,
      productId: item.productId,
      title: item.title,
      accessMode: item.accessMode,
      priceCents: item.priceCents,
      status: item.status,
      archived: item.archived,
      position: item.position,
    })),
    itemsPriceCents: bundle.itemsPriceCents,
    studentCount: bundle.studentCount,
  };
}

const BUNDLE_FIELDS = [
  'slug',
  'title',
  'summary',
  'description',
  'coverImageId',
  'accessMode',
  'priceCents',
  'accessDays',
] as const;

const EBOOK_FIELDS = [...BUNDLE_FIELDS, 'authorName', 'fileUrl', 'pages'] as const;

function listQuery(query: Record<string, unknown>) {
  return {
    q: query.q,
    status: query.status,
    accessMode: query.accessMode,
    sort: query.sort,
    limit: query.limit,
    cursor: query.cursor,
  };
}

export function registerProductRoutes(app: FastifyInstance, options: ProductRoutesOptions): void {
  const { db } = options;

  // Ebooks.

  // `GET /api/v1/ebooks` (`ebook.link`): o instrutor lê a lista inteira, para vincular.
  app.operation('listEbooks', async (request) => {
    const page = await listAdminEbooks(
      db,
      catalogRequest(request),
      listQuery(request.query as Record<string, unknown>),
    );
    return { items: page.items.map(ebookSummaryBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/ebooks`: nasce `draft`; sem `slug`, o núcleo o gera do título.
  app.operation('createEbook', async (request, reply) => {
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown> & { title: string };
    const created = await createEbook(db, actor, {
      ...pick(body, EBOOK_FIELDS),
      title: body.title,
    });
    return reply.status(201).send(ebookDetailBody(await getAdminEbook(db, actor, created.id)));
  });

  // O instrutor vê só os vínculos com os próprios cursos e aulas.
  app.operation('getEbook', async (request) => {
    const { id } = request.params as IdParams;
    return ebookDetailBody(await getAdminEbook(db, catalogRequest(request), id));
  });

  // `PATCH /api/v1/ebooks/{id}`: campo omitido não muda. Modo de acesso e preço: `403` do núcleo
  // para quem não tem a ação.
  app.operation('updateEbook', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown>;
    await updateEbook(db, actor, id, { ...pick(body, EBOOK_FIELDS), version: body.version });
    return ebookDetailBody(await getAdminEbook(db, actor, id));
  });

  app.operation('deleteEbook', async (request, reply) => {
    const { id } = request.params as IdParams;
    await deleteEbook(db, catalogRequest(request), id);
    return reply.status(204).send();
  });

  // Mudanças de estado do ebook: a regra grava e a resposta é o ebook como o editor o vê.
  const ebookTransitions = {
    publishEbook,
    unpublishEbook,
    archiveEbook,
    unarchiveEbook,
  } as const;
  for (const [operationId, transition] of Object.entries(ebookTransitions)) {
    app.operation(operationId, async (request) => {
      const { id } = request.params as IdParams;
      const actor = catalogRequest(request);
      const ebook = await transition(db, actor, id);
      return ebookDetailBody(await getAdminEbook(db, actor, ebook.id));
    });
  }

  // `PUT /api/v1/ebooks/{id}/targets` (`ebook.link`): troca os vínculos a cursos e aulas. O
  // núcleo preserva os vínculos `bundle` (que aparecem em `targets` da resposta) e, para o
  // instrutor, os de cursos alheios; `bundle` no corpo já é `400` pelo contrato.
  app.operation('setEbookTargets', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { targets, version } = request.body as {
      targets: Array<{ targetType: 'course' | 'lesson'; targetId: string }>;
      version?: number;
    };
    await setEbookTargets(db, actor, id, {
      targets: targets.map((target) => ({
        targetType: target.targetType,
        targetId: target.targetId,
      })),
      version,
    });
    return ebookDetailBody(await getAdminEbook(db, actor, id));
  });

  // `PUT` e `DELETE /api/v1/ebooks/{id}/targets/{targetType}/{targetId}` (`ebook.link`): um
  // vínculo só, sem `version` e sem tocar nos outros; idempotentes (`204` em ambos os casos).
  const ebookLinkChanges = { linkEbookTarget, unlinkEbookTarget } as const;
  for (const [operationId, change] of Object.entries(ebookLinkChanges)) {
    app.operation(operationId, async (request, reply) => {
      const { id, targetType, targetId } = request.params as IdParams & {
        targetType: 'course' | 'lesson';
        targetId: string;
      };
      await change(db, catalogRequest(request), id, { targetType, targetId });
      return reply.status(204).send();
    });
  }

  // Pacotes.

  app.operation('listBundles', async (request) => {
    const page = await listAdminBundles(
      db,
      catalogRequest(request),
      listQuery(request.query as Record<string, unknown>),
    );
    return { items: page.items.map(bundleSummaryBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/bundles`: nasce `draft`, sem itens; sem `slug`, o núcleo o gera do título.
  app.operation('createBundle', async (request, reply) => {
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown> & { title: string };
    const created = await createBundle(db, actor, {
      ...pick(body, BUNDLE_FIELDS),
      title: body.title,
    });
    return reply.status(201).send(bundleDetailBody(await getAdminBundle(db, actor, created.id)));
  });

  app.operation('getBundle', async (request) => {
    const { id } = request.params as IdParams;
    return bundleDetailBody(await getAdminBundle(db, catalogRequest(request), id));
  });

  app.operation('updateBundle', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const body = request.body as Record<string, unknown>;
    await updateBundle(db, actor, id, { ...pick(body, BUNDLE_FIELDS), version: body.version });
    return bundleDetailBody(await getAdminBundle(db, actor, id));
  });

  app.operation('deleteBundle', async (request, reply) => {
    const { id } = request.params as IdParams;
    await deleteBundle(db, catalogRequest(request), id);
    return reply.status(204).send();
  });

  const bundleTransitions = {
    publishBundle,
    unpublishBundle,
    archiveBundle,
    unarchiveBundle,
  } as const;
  for (const [operationId, transition] of Object.entries(bundleTransitions)) {
    app.operation(operationId, async (request) => {
      const { id } = request.params as IdParams;
      const actor = catalogRequest(request);
      const bundle = await transition(db, actor, id);
      return bundleDetailBody(await getAdminBundle(db, actor, bundle.id));
    });
  }

  // `PUT /api/v1/bundles/{id}/items`: troca a lista inteira, na ordem enviada. `version`
  // opcional: enviada e diferente da gravada, `409`. Mudança de composição enfileira o
  // `entitlement.recompute` do pacote na transação da escrita.
  app.operation('setBundleItems', async (request) => {
    const { id } = request.params as IdParams;
    const actor = catalogRequest(request);
    const { items, version } = request.body as {
      items: Array<{ productType: string; productId: string }>;
      version?: number;
    };
    await setBundleItems(db, actor, id, {
      items: items.map((item) => ({ productType: item.productType, productId: item.productId })),
      version,
    });
    return bundleDetailBody(await getAdminBundle(db, actor, id));
  });
}
