// Ebooks e pacotes (spec 009, RF-02, RF-03, RF-06): criar, alterar, excluir, publicar,
// despublicar, arquivar, desarquivar, itens do pacote e vínculos do ebook. Ebook e pacote são
// de gerente e admin (`ebook_bundle.manage`); o instrutor só vincula ebook existente aos
// próprios cursos e aulas (`ebook.link`). Dono dos dados: admin-api.

import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { permissionScope } from '../permissions/matrix.ts';
import {
  applyCommercialChange,
  assertCatalogId,
  assertProductCover,
  assertPublishablePrice,
  assertVersion,
  auditCommercialChange,
  bundlesContaining,
  type CatalogRequest,
  type CommercialInput,
  type CommercialState,
  catalogAudit,
  catalogUnprocessable,
  catalogWrite,
  countActiveEntitlementHolders,
  diffFields,
  enqueueRecomputes,
  freeGeneratedSlug,
  INITIAL_COMMERCIAL,
  priceFromDb,
  productHasLinks,
  productHasLinksError,
  readCommercialInput,
  recomputeParentOfTarget,
  requireCatalogAction,
  requireCommercialPermissions,
  withSlugCheck,
} from './common.ts';
import {
  type AccessMode,
  CATALOG_LIMITS,
  catalogLimitExceeded,
  catalogRule,
  FieldErrors,
  type PublicationStatus,
  readArray,
  readEnum,
  readId,
  readNullableId,
  readNullableInteger,
  readObject,
  readOptionalText,
  readOptionalVersion,
  readSlug,
  readTitle,
  readVersion,
} from './fields.ts';
import { checkContentUrl, contentUrlInvalid, contentUrlProblemMessage } from './urls.ts';

type ProductKind = 'ebook' | 'bundle';

interface ProductBase {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  coverImageId: string | null;
  accessMode: AccessMode;
  priceCents: number | null;
  accessDays: number | null;
  status: PublicationStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogEbook extends ProductBase {
  authorName: string | null;
  fileUrl: string | null;
  pages: number | null;
}

export type CatalogBundle = ProductBase;

export interface CatalogBundleItem {
  productType: 'course' | 'ebook';
  productId: string;
  position: number;
}

/** Os tipos de vínculo do ebook que a leitura devolve (o `bundle` só nasce de carga direta). */
export const EBOOK_TARGET_TYPES = ['course', 'lesson', 'bundle'] as const;
export type EbookTargetType = (typeof EBOOK_TARGET_TYPES)[number];

/**
 * Os alvos que a escrita de vínculos do ebook aceita (`setEbookTargets`, `linkEbookTarget`): só
 * curso e aula. O vínculo `bundle` existente é preservado, nunca criado nem removido por elas.
 */
export const EBOOK_SINGLE_TARGET_TYPES = ['course', 'lesson'] as const;
export type EbookWritableTargetType = (typeof EBOOK_SINGLE_TARGET_TYPES)[number];

export interface CatalogEbookTarget {
  targetType: EbookTargetType;
  targetId: string;
}

const TABLE = { ebook: 'ebooks', bundle: 'bundles' } as const;
const SLUG_CONSTRAINT = { ebook: 'ebooks_slug_unique', bundle: 'bundles_slug_unique' } as const;
const LABEL = { ebook: 'Ebook', bundle: 'Pacote' } as const;

// As colunas comuns têm o mesmo nome em `ebooks` e `bundles`; a tabela é escolhida em tempo de
// execução e tipada como `ebooks` só para o Kysely (as colunas próprias do ebook só aparecem nos
// caminhos do ebook).
function table(kind: ProductKind): 'ebooks' {
  return TABLE[kind] as 'ebooks';
}

async function findProduct(
  db: Database,
  kind: ProductKind,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<(CatalogEbook & CatalogBundle) | undefined> {
  let query = db.selectFrom(table(kind)).selectAll().where('id', '=', id);
  if (options.forUpdate) query = query.forUpdate();
  const row = (await query.executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    ...(row as unknown as CatalogEbook),
    authorName: (row.authorName as string | null | undefined) ?? null,
    fileUrl: (row.fileUrl as string | null | undefined) ?? null,
    pages: (row.pages as number | null | undefined) ?? null,
    priceCents: priceFromDb(row.priceCents as string | null),
  };
}

function shapeEbook(product: CatalogEbook): CatalogEbook {
  return product;
}

function shapeBundle(product: CatalogEbook): CatalogBundle {
  const { authorName: _a, fileUrl: _f, pages: _p, ...bundle } = product;
  return bundle;
}

function commercialOf(product: ProductBase): CommercialState {
  return {
    accessMode: product.accessMode,
    priceCents: product.priceCents,
    accessDays: product.accessDays,
  };
}

async function loadProductForWrite(
  trx: Database,
  request: CatalogRequest,
  kind: ProductKind,
  productId: unknown,
  auditAction: string,
  permission: 'ebook_bundle.manage' | 'product.archive' = 'ebook_bundle.manage',
): Promise<CatalogEbook> {
  const id = assertCatalogId(productId, LABEL[kind]);
  requireCatalogAction(request, permission, { action: auditAction, target: { type: kind, id } });
  const product = await findProduct(trx, kind, id, { forUpdate: true });
  if (!product) throw notFound(`${LABEL[kind]} não encontrado.`);
  return product;
}

export interface ProductFieldsInput extends CommercialInput {
  slug?: unknown;
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  coverImageId?: unknown;
}

export interface EbookFieldsInput extends ProductFieldsInput {
  authorName?: unknown;
  /** Link externo do arquivo (spec 009, "Vídeo e links externos"). */
  fileUrl?: unknown;
  pages?: unknown;
}

type ProductFields = Record<string, unknown>;

function readProductFields(
  errors: FieldErrors,
  kind: ProductKind,
  input: EbookFieldsInput,
): ProductFields {
  const fields: ProductFields = {};
  if (input.slug !== undefined) fields.slug = readSlug(errors, input.slug, 'body.slug');
  if (input.title !== undefined) fields.title = readTitle(errors, input.title, 'body.title');
  if (input.summary !== undefined) {
    fields.summary = readOptionalText(
      errors,
      input.summary,
      'body.summary',
      CATALOG_LIMITS.summaryMaxLength,
    );
  }
  if (input.description !== undefined) {
    fields.description = readOptionalText(
      errors,
      input.description,
      'body.description',
      CATALOG_LIMITS.descriptionMaxLength,
      { trim: false },
    );
  }
  if (input.coverImageId !== undefined) {
    fields.coverImageId = readNullableId(errors, input.coverImageId, 'body.coverImageId');
  }
  if (kind === 'ebook') {
    if (input.authorName !== undefined) {
      fields.authorName = readOptionalText(
        errors,
        input.authorName,
        'body.authorName',
        CATALOG_LIMITS.authorNameMaxLength,
      );
    }
    if (input.pages !== undefined) {
      fields.pages = readNullableInteger(
        errors,
        input.pages,
        'body.pages',
        1,
        CATALOG_LIMITS.pagesMax,
      );
    }
  }
  return fields;
}

/** `file_url` validada depois dos campos de formato (é `422`, não `400`). */
function readFileUrl(kind: ProductKind, fields: ProductFields, input: EbookFieldsInput): void {
  if (kind !== 'ebook' || input.fileUrl === undefined) return;
  if (input.fileUrl === null) {
    fields.fileUrl = null;
    return;
  }
  const check = checkContentUrl(input.fileUrl);
  if (!check.ok) {
    throw contentUrlInvalid([
      { path: 'body.fileUrl', message: contentUrlProblemMessage(check.problem) },
    ]);
  }
  fields.fileUrl = input.fileUrl;
}

async function createProduct(
  db: Database,
  request: CatalogRequest,
  kind: ProductKind,
  input: EbookFieldsInput,
): Promise<CatalogEbook> {
  return catalogWrite(db, request, async (trx) => {
    const target = { type: kind, id: null };
    requireCatalogAction(request, 'ebook_bundle.manage', { action: `${kind}.create`, target });
    requireCommercialPermissions(request, INITIAL_COMMERCIAL, input, target);
    const errors = new FieldErrors();
    const fields = readProductFields(errors, kind, {
      ...input,
      slug: input.slug ?? undefined,
      title: input.title ?? null,
    });
    const commercial = readCommercialInput(errors, input);
    errors.throwIfAny();
    readFileUrl(kind, fields, input);
    const change = applyCommercialChange(INITIAL_COMMERCIAL, commercial);
    await assertProductCover(trx, (fields.coverImageId as string | null | undefined) ?? null);
    fields.slug ??= await freeGeneratedSlug(trx, kind, fields.title as string);
    const row = await withSlugCheck(SLUG_CONSTRAINT[kind], () =>
      trx
        .insertInto(table(kind))
        .values({
          ...(fields as { slug: string; title: string }),
          accessMode: change.next.accessMode,
          priceCents: change.next.priceCents,
          accessDays: change.next.accessDays,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await catalogAudit(trx, request, {
      action: `${kind}.create`,
      targetType: kind,
      targetId: row.id,
      details: { slug: fields.slug, accessMode: change.next.accessMode },
    });
    await auditCommercialChange(trx, request, INITIAL_COMMERCIAL, change, {
      type: kind,
      id: row.id,
    });
    return (await findProduct(trx, kind, row.id)) as CatalogEbook;
  });
}

async function updateProduct(
  db: Database,
  request: CatalogRequest,
  kind: ProductKind,
  productId: unknown,
  input: EbookFieldsInput & { version: unknown },
): Promise<CatalogEbook> {
  return catalogWrite(db, request, async (trx) => {
    const product = await loadProductForWrite(trx, request, kind, productId, `${kind}.update`);
    const target = { type: kind, id: product.id };
    requireCommercialPermissions(request, commercialOf(product), input, target);
    const version = readVersion(input.version);
    const errors = new FieldErrors();
    const fields = readProductFields(errors, kind, input);
    const commercial = readCommercialInput(errors, input);
    errors.throwIfAny();
    readFileUrl(kind, fields, input);
    assertVersion(product.version, version);
    const change = applyCommercialChange(commercialOf(product), commercial);
    if (product.status === 'published') {
      assertPublishablePrice(change.next);
      if (kind === 'ebook' && fields.fileUrl === null) {
        throw catalogRule('ebook_file_required', 'Ebook publicado precisa do link do arquivo.');
      }
    }
    if (fields.coverImageId !== undefined && fields.coverImageId !== product.coverImageId) {
      await assertProductCover(trx, fields.coverImageId as string | null);
    }
    const changes = diffFields(product as unknown as Record<string, unknown>, fields);
    const commercialChanged =
      change.accessChanged || change.priceChanged || change.priceClearedByMode;
    if (Object.keys(changes).length === 0 && !commercialChanged) return product;
    await withSlugCheck(SLUG_CONSTRAINT[kind], () =>
      trx
        .updateTable(table(kind))
        .set({
          ...fields,
          accessMode: change.next.accessMode,
          priceCents: change.next.priceCents,
          accessDays: change.next.accessDays,
          version: sql<number>`version + 1`,
        })
        .where('id', '=', product.id)
        .execute(),
    );
    if (Object.keys(changes).length > 0) {
      await catalogAudit(trx, request, {
        action: `${kind}.update`,
        targetType: kind,
        targetId: product.id,
        details: changes,
      });
    }
    await auditCommercialChange(trx, request, commercialOf(product), change, target);
    return (await findProduct(trx, kind, product.id)) as CatalogEbook;
  });
}

async function deleteProduct(
  db: Database,
  request: CatalogRequest,
  kind: ProductKind,
  productId: unknown,
): Promise<void> {
  await catalogWrite(db, request, async (trx) => {
    const product = await loadProductForWrite(trx, request, kind, productId, `${kind}.delete`);
    if (await productHasLinks(trx, kind, product.id)) throw productHasLinksError();
    if (kind === 'ebook') {
      const targets = await trx
        .selectFrom('productEbooks')
        .select(['targetType', 'targetId'])
        .where('ebookId', '=', product.id)
        .execute();
      const parents = [];
      for (const target of targets) {
        const parent = await recomputeParentOfTarget(trx, target);
        if (parent) parents.push(parent);
      }
      for (const bundleId of await bundlesContaining(trx, 'ebook', product.id)) {
        parents.push({ productType: 'bundle' as const, productId: bundleId });
      }
      await trx
        .deleteFrom('bundleItems')
        .where('productType', '=', 'ebook')
        .where('productId', '=', product.id)
        .execute();
      await enqueueRecomputes(trx, parents);
    } else {
      await trx
        .deleteFrom('productEbooks')
        .where('targetType', '=', 'bundle')
        .where('targetId', '=', product.id)
        .execute();
    }
    await trx.deleteFrom(table(kind)).where('id', '=', product.id).execute();
    await catalogAudit(trx, request, {
      action: `${kind}.delete`,
      targetType: kind,
      targetId: product.id,
      details: { slug: product.slug, title: product.title },
    });
  });
}

async function setProductPublished(
  db: Database,
  request: CatalogRequest,
  kind: ProductKind,
  productId: unknown,
  published: boolean,
): Promise<CatalogEbook> {
  const action = `${kind}.${published ? 'publish' : 'unpublish'}`;
  return catalogWrite(db, request, async (trx) => {
    const product = await loadProductForWrite(trx, request, kind, productId, action);
    if ((product.status === 'published') === published) return product;
    let affected: number | undefined;
    if (published) {
      if (product.archivedAt !== null) {
        throw catalogRule('product_archived', 'Produto arquivado; desarquive antes.');
      }
      assertPublishablePrice(commercialOf(product));
      if (kind === 'ebook' && product.fileUrl === null) {
        throw catalogRule('ebook_file_required', 'Informe o link do arquivo antes de publicar.');
      }
      if (kind === 'bundle' && (await listItems(trx, product.id)).length === 0) {
        throw catalogRule('bundle_has_no_items', 'O pacote precisa de ao menos um item.');
      }
    } else {
      affected = await countActiveEntitlementHolders(trx, kind, product.id);
    }
    await trx
      .updateTable(table(kind))
      .set(
        published
          ? {
              status: 'published',
              publishedAt: sql<Date>`now()`,
              version: sql<number>`version + 1`,
            }
          : { status: 'draft', version: sql<number>`version + 1` },
      )
      .where('id', '=', product.id)
      .execute();
    await catalogAudit(trx, request, {
      action,
      targetType: kind,
      targetId: product.id,
      ...(affected === undefined ? {} : { details: { affectedStudents: affected } }),
    });
    return (await findProduct(trx, kind, product.id)) as CatalogEbook;
  });
}

async function setProductArchived(
  db: Database,
  request: CatalogRequest,
  kind: ProductKind,
  productId: unknown,
  archived: boolean,
): Promise<CatalogEbook> {
  const action = `${kind}.${archived ? 'archive' : 'unarchive'}`;
  return catalogWrite(db, request, async (trx) => {
    const product = await loadProductForWrite(
      trx,
      request,
      kind,
      productId,
      action,
      'product.archive',
    );
    if ((product.archivedAt !== null) === archived) return product;
    await trx
      .updateTable(table(kind))
      .set(
        archived
          ? { archivedAt: sql<Date>`now()`, status: 'draft', version: sql<number>`version + 1` }
          : { archivedAt: null, version: sql<number>`version + 1` },
      )
      .where('id', '=', product.id)
      .execute();
    await catalogAudit(trx, request, {
      action,
      targetType: kind,
      targetId: product.id,
      details: { wasPublished: product.status === 'published' },
    });
    return (await findProduct(trx, kind, product.id)) as CatalogEbook;
  });
}

async function countProductAffected(
  db: Database,
  request: CatalogRequest,
  kind: ProductKind,
  productId: unknown,
): Promise<number> {
  return catalogWrite(db, request, async (trx) => {
    const id = assertCatalogId(productId, LABEL[kind]);
    requireCatalogAction(request, 'ebook_bundle.manage', {
      action: `${kind}.unpublish`,
      target: { type: kind, id },
    });
    if (!(await findProduct(trx, kind, id))) throw notFound(`${LABEL[kind]} não encontrado.`);
    return countActiveEntitlementHolders(trx, kind, id);
  });
}

// Ebooks.

/** Lê o ebook (sem conferir permissão). */
export async function findCatalogEbook(
  db: Database,
  ebookId: string,
): Promise<CatalogEbook | undefined> {
  const product = await findProduct(db, 'ebook', ebookId);
  return product ? shapeEbook(product) : undefined;
}

/**
 * `POST /ebooks` (`ebook_bundle.manage`). Nasce `draft` e `private`, sem preço; `fileUrl` fora
 * das regras: `422` `content_url_invalid`. Modo e validade: `product.set_access`; preço:
 * `product.set_price` (`403` antes das regras do valor). Sem `slug`, ele é gerado do título
 * (sufixo `-2` a `-99` se repetido); informado repetido: `409` `slug_taken`. Grava
 * `ebook.create`.
 */
export async function createEbook(
  db: Database,
  request: CatalogRequest,
  input: EbookFieldsInput & { title: unknown },
): Promise<CatalogEbook> {
  return shapeEbook(await createProduct(db, request, 'ebook', input));
}

/** `PATCH /ebooks/{id}`, com `version`. Ebook publicado não perde o `fileUrl` nem o preço. */
export async function updateEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
  input: EbookFieldsInput & { version: unknown },
): Promise<CatalogEbook> {
  return shapeEbook(await updateProduct(db, request, 'ebook', ebookId, input));
}

/**
 * `DELETE /ebooks/{id}`: com direito associado, `409` `product_has_links` para todos (P2). Tira
 * o ebook dos pacotes e dos vínculos, com o recálculo de cada pai. Grava `ebook.delete`.
 */
export async function deleteEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<void> {
  await deleteProduct(db, request, 'ebook', ebookId);
}

/** `POST /ebooks/{id}/publish`: exige `fileUrl` (`422` `ebook_file_required`) e preço se `paid`. */
export async function publishEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<CatalogEbook> {
  return shapeEbook(await setProductPublished(db, request, 'ebook', ebookId, true));
}

export async function unpublishEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<CatalogEbook> {
  return shapeEbook(await setProductPublished(db, request, 'ebook', ebookId, false));
}

/** `POST /ebooks/{id}/archive` (`product.archive`, só admin). */
export async function archiveEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<CatalogEbook> {
  return shapeEbook(await setProductArchived(db, request, 'ebook', ebookId, true));
}

export async function unarchiveEbook(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<CatalogEbook> {
  return shapeEbook(await setProductArchived(db, request, 'ebook', ebookId, false));
}

/** Alunos com direito vigente ao ebook (aviso antes de despublicar). */
export async function countEbookAffectedStudents(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
): Promise<number> {
  return countProductAffected(db, request, 'ebook', ebookId);
}

// Pacotes.

/** Lê o pacote (sem conferir permissão). */
export async function findCatalogBundle(
  db: Database,
  bundleId: string,
): Promise<CatalogBundle | undefined> {
  const product = await findProduct(db, 'bundle', bundleId);
  return product ? shapeBundle(product) : undefined;
}

/** `POST /bundles` (`ebook_bundle.manage`). Mesmas regras do ebook, sem arquivo. */
export async function createBundle(
  db: Database,
  request: CatalogRequest,
  input: ProductFieldsInput & { title: unknown },
): Promise<CatalogBundle> {
  return shapeBundle(await createProduct(db, request, 'bundle', input));
}

export async function updateBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
  input: ProductFieldsInput & { version: unknown },
): Promise<CatalogBundle> {
  return shapeBundle(await updateProduct(db, request, 'bundle', bundleId, input));
}

/** `DELETE /bundles/{id}`: com direito associado, `409` `product_has_links` (P2). */
export async function deleteBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<void> {
  await deleteProduct(db, request, 'bundle', bundleId);
}

/** `POST /bundles/{id}/publish`: exige ao menos um item (`422` `bundle_has_no_items`). */
export async function publishBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<CatalogBundle> {
  return shapeBundle(await setProductPublished(db, request, 'bundle', bundleId, true));
}

export async function unpublishBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<CatalogBundle> {
  return shapeBundle(await setProductPublished(db, request, 'bundle', bundleId, false));
}

export async function archiveBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<CatalogBundle> {
  return shapeBundle(await setProductArchived(db, request, 'bundle', bundleId, true));
}

export async function unarchiveBundle(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<CatalogBundle> {
  return shapeBundle(await setProductArchived(db, request, 'bundle', bundleId, false));
}

/**
 * Alunos com direito vigente ao pacote: o número do aviso antes de despublicar ou de remover um
 * item (spec 009, "Pacotes").
 */
export async function countBundleAffectedStudents(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
): Promise<number> {
  return countProductAffected(db, request, 'bundle', bundleId);
}

async function listItems(trx: Database, bundleId: string): Promise<CatalogBundleItem[]> {
  const rows = await trx
    .selectFrom('bundleItems')
    .select(['productType', 'productId', 'position'])
    .where('bundleId', '=', bundleId)
    .orderBy('position')
    .execute();
  return rows.map((row) => ({ ...row, productType: row.productType as 'course' | 'ebook' }));
}

/** Itens do pacote, na ordem. */
export async function listCatalogBundleItems(
  db: Database,
  bundleId: string,
): Promise<CatalogBundleItem[]> {
  return listItems(db, bundleId);
}

/** Quais dos ids existem na tabela. */
async function existingIds(
  trx: Database,
  tableName: 'courses' | 'ebooks' | 'bundles' | 'lessons',
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await trx
    .selectFrom(tableName as 'courses')
    .select('id')
    .where('id', 'in', [...ids])
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * `PUT /bundles/{id}/items` (`ebook_bundle.manage`): troca a lista inteira de itens (cursos e
 * ebooks), na ordem dada. `productType` fora de `course` | `ebook` (inclusive `bundle`) e item
 * repetido: `400` `validation_failed`; item inexistente: `422` `catalog_item_not_found` com o
 * índice. Até 200 itens. Pacote
 * publicado não fica vazio (`422` `bundle_has_no_items`). Mudança de composição enfileira
 * `entitlement.recompute` do pacote na mesma transação (só a ordem, não). `version` opcional é
 * o do pacote, que avança. Grava `bundle.set_items`.
 */
export async function setBundleItems(
  db: Database,
  request: CatalogRequest,
  bundleId: unknown,
  input: { items: unknown; version?: unknown },
): Promise<CatalogBundleItem[]> {
  return catalogWrite(db, request, async (trx) => {
    const bundle = await loadProductForWrite(trx, request, 'bundle', bundleId, 'bundle.set_items');
    const version = readOptionalVersion(input.version);
    const errors = new FieldErrors();
    const list = readArray(errors, input.items, 'body.items');
    const items = list.map((item, index) => {
      const path = `body.items[${index}]`;
      const value = readObject(errors, item, path);
      return {
        productType: readEnum(errors, value.productType, `${path}.productType`, [
          'course',
          'ebook',
        ] as const),
        productId: readId(errors, value.productId, `${path}.productId`),
      };
    });
    const keys = items.map((item) => `${item.productType}:${item.productId}`);
    keys.forEach((key, index) => {
      if (keys.indexOf(key) !== index) errors.add(`body.items[${index}]`, 'Item repetido.');
    });
    errors.throwIfAny();
    if (items.length > CATALOG_LIMITS.itemsPerBundle) {
      throw catalogLimitExceeded(
        'itemsPerBundle',
        `O pacote aceita até ${CATALOG_LIMITS.itemsPerBundle} itens.`,
      );
    }
    assertVersion(bundle.version, version);
    if (bundle.status === 'published' && items.length === 0) {
      throw catalogRule('bundle_has_no_items', 'Pacote publicado precisa de ao menos um item.');
    }
    const courses = await existingIds(
      trx,
      'courses',
      items.filter((item) => item.productType === 'course').map((item) => item.productId),
    );
    const ebooks = await existingIds(
      trx,
      'ebooks',
      items.filter((item) => item.productType === 'ebook').map((item) => item.productId),
    );
    const missing = items.flatMap((item, index) =>
      (item.productType === 'course' ? courses : ebooks).has(item.productId)
        ? []
        : [{ path: `body.items[${index}].productId`, message: 'Produto não encontrado.' }],
    );
    if (missing.length > 0) {
      throw catalogUnprocessable('catalog_item_not_found', 'Item do pacote não existe.', missing);
    }
    const before = await listItems(trx, bundle.id);
    const beforeKeys = new Set(before.map((item) => `${item.productType}:${item.productId}`));
    const added = keys.filter((key) => !beforeKeys.has(key)).length;
    const removed = [...beforeKeys].filter((key) => !keys.includes(key)).length;
    await trx.deleteFrom('bundleItems').where('bundleId', '=', bundle.id).execute();
    if (items.length > 0) {
      await trx
        .insertInto('bundleItems')
        .values(items.map((item, position) => ({ bundleId: bundle.id, ...item, position })))
        .execute();
    }
    await trx
      .updateTable('bundles')
      .set({ version: sql<number>`version + 1` })
      .where('id', '=', bundle.id)
      .execute();
    if (added > 0 || removed > 0) {
      await enqueueRecomputes(trx, [{ productType: 'bundle', productId: bundle.id }]);
    }
    await catalogAudit(trx, request, {
      action: 'bundle.set_items',
      targetType: 'bundle',
      targetId: bundle.id,
      details: { count: items.length, added, removed },
    });
    return listItems(trx, bundle.id);
  });
}

// Vínculos do ebook (`product_ebooks`).

interface ResolvedTarget extends CatalogEbookTarget {
  /** Dono do curso do alvo (curso ou aula); `undefined` para pacote. */
  ownerId?: string | null;
}

async function resolveTargets(
  trx: Database,
  targets: readonly CatalogEbookTarget[],
): Promise<Map<string, ResolvedTarget>> {
  const resolved = new Map<string, ResolvedTarget>();
  const ofType = (type: EbookTargetType) =>
    targets.filter((target) => target.targetType === type).map((target) => target.targetId);
  const courseIds = ofType('course');
  if (courseIds.length > 0) {
    const rows = await trx
      .selectFrom('courses')
      .select(['id', 'ownerId'])
      .where('id', 'in', courseIds)
      .execute();
    for (const row of rows) {
      resolved.set(`course:${row.id}`, {
        targetType: 'course',
        targetId: row.id,
        ownerId: row.ownerId,
      });
    }
  }
  const lessonIds = ofType('lesson');
  if (lessonIds.length > 0) {
    const rows = await trx
      .selectFrom('lessons')
      .innerJoin('modules', 'modules.id', 'lessons.moduleId')
      .innerJoin('courses', 'courses.id', 'modules.courseId')
      .select(['lessons.id', 'courses.ownerId'])
      .where('lessons.id', 'in', lessonIds)
      .execute();
    for (const row of rows) {
      resolved.set(`lesson:${row.id}`, {
        targetType: 'lesson',
        targetId: row.id,
        ownerId: row.ownerId,
      });
    }
  }
  for (const id of await existingIds(trx, 'bundles', ofType('bundle'))) {
    resolved.set(`bundle:${id}`, { targetType: 'bundle', targetId: id });
  }
  return resolved;
}

/** Vínculos do ebook que quem pede alcança (o instrutor: só os dos próprios cursos e aulas). */
export async function listCatalogEbookTargets(
  db: Database,
  request: CatalogRequest,
  ebookId: string,
): Promise<CatalogEbookTarget[]> {
  const rows = await db
    .selectFrom('productEbooks')
    .select(['targetType', 'targetId'])
    .where('ebookId', '=', ebookId)
    .orderBy('targetType')
    .orderBy('targetId')
    .execute();
  const targets = rows as CatalogEbookTarget[];
  const resolved = await resolveTargets(db, targets);
  return targets.filter((target) =>
    reachable(request, resolved.get(`${target.targetType}:${target.targetId}`)),
  );
}

function reachable(request: CatalogRequest, target: ResolvedTarget | undefined): boolean {
  if (!target) return false;
  if (permissionScope(request.actor, 'ebook.link') === 'all') return true;
  return target.targetType !== 'bundle' && target.ownerId === request.actor.id;
}

/**
 * `PUT /ebooks/{id}/targets` (`ebook.link`): troca os vínculos do ebook a cursos e aulas (spec
 * 009, "Vínculo `bundle` no admin"). `targetType` fora de `course` | `lesson` (inclusive
 * `bundle`) é `400` `validation_failed`, para qualquer papel. Os vínculos `bundle` do ebook nunca
 * são removidos, criados nem contados em `added`/`removed`, e não recalculam o pacote. Gerente e
 * admin trocam o conjunto dos vínculos `course` e `lesson`, e alvo inexistente é `422`
 * `catalog_item_not_found`; o instrutor troca só os dos próprios cursos e aulas (alvo alheio ou
 * inexistente é `404`), e os que ele não alcança ficam como estão. O limite `targetsPerEbook`
 * conta todos os vínculos do ebook depois da gravação, inclusive os que a troca não alcança:
 * acima dele, `422` `catalog_limit_exceeded`. Cada vínculo que entra ou sai enfileira
 * `entitlement.recompute` do pai (aula: o curso dela). Grava `ebook.set_targets`. Devolve os
 * vínculos que quem pede alcança.
 */
export async function setEbookTargets(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
  input: { targets: unknown; version?: unknown },
): Promise<CatalogEbookTarget[]> {
  return catalogWrite(db, request, async (trx) => {
    const id = assertCatalogId(ebookId, 'Ebook');
    const target = { type: 'ebook' as const, id };
    requireCatalogAction(request, 'ebook.link', { action: 'ebook.set_targets', target });
    const ebook = await findProduct(trx, 'ebook', id, { forUpdate: true });
    if (!ebook) throw notFound('Ebook não encontrado.');
    const version = readOptionalVersion(input.version);
    const errors = new FieldErrors();
    const list = readArray(errors, input.targets, 'body.targets');
    const wanted = list.map((item, index) => {
      const path = `body.targets[${index}]`;
      const value = readObject(errors, item, path);
      return {
        targetType: readEnum(
          errors,
          value.targetType,
          `${path}.targetType`,
          EBOOK_SINGLE_TARGET_TYPES,
        ),
        targetId: readId(errors, value.targetId, `${path}.targetId`),
      };
    });
    const keys = wanted.map((item) => `${item.targetType}:${item.targetId}`);
    keys.forEach((key, index) => {
      if (keys.indexOf(key) !== index) errors.add(`body.targets[${index}]`, 'Vínculo repetido.');
    });
    errors.throwIfAny();
    // Tudo o que se pede fica vinculado: acima do limite já não cabe, sem olhar o banco.
    if (wanted.length > CATALOG_LIMITS.targetsPerEbook) throw targetsLimitExceeded();
    assertVersion(ebook.version, version);
    const fullScope = permissionScope(request.actor, 'ebook.link') === 'all';
    const resolvedWanted = await resolveTargets(trx, wanted);
    const missing = wanted.flatMap((item, index) =>
      resolvedWanted.has(`${item.targetType}:${item.targetId}`)
        ? []
        : [{ path: `body.targets[${index}].targetId`, message: 'Alvo não encontrado.' }],
    );
    if (!fullScope) {
      const outOfReach = wanted.some(
        (item) => !reachable(request, resolvedWanted.get(`${item.targetType}:${item.targetId}`)),
      );
      if (outOfReach) throw notFound('Curso ou aula não encontrado.');
    }
    if (missing.length > 0) {
      throw catalogUnprocessable('catalog_item_not_found', 'Alvo do vínculo não existe.', missing);
    }
    const current = (await trx
      .selectFrom('productEbooks')
      .select(['targetType', 'targetId'])
      .where('ebookId', '=', id)
      .execute()) as CatalogEbookTarget[];
    const resolvedCurrent = await resolveTargets(trx, current);
    // O vínculo `bundle` nunca entra no conjunto gerido (`reachable` já o tira do instrutor).
    const managed = fullScope
      ? current.filter((item) => item.targetType !== 'bundle')
      : current.filter((item) =>
          reachable(request, resolvedCurrent.get(`${item.targetType}:${item.targetId}`)),
        );
    const wantedKeys = new Set(keys);
    const removed = managed.filter(
      (item) => !wantedKeys.has(`${item.targetType}:${item.targetId}`),
    );
    const currentKeys = new Set(current.map((item) => `${item.targetType}:${item.targetId}`));
    const added = wanted.filter((item) => !currentKeys.has(`${item.targetType}:${item.targetId}`));
    if (current.length - removed.length + added.length > CATALOG_LIMITS.targetsPerEbook) {
      throw targetsLimitExceeded();
    }
    for (const item of removed) {
      await trx
        .deleteFrom('productEbooks')
        .where('ebookId', '=', id)
        .where('targetType', '=', item.targetType)
        .where('targetId', '=', item.targetId)
        .execute();
    }
    if (added.length > 0) {
      await trx
        .insertInto('productEbooks')
        .values(added.map((item) => ({ ebookId: id, ...item })))
        .execute();
    }
    const parents = [];
    for (const item of [...removed, ...added]) {
      const parent = await recomputeParentOfTarget(trx, item);
      if (parent) parents.push(parent);
    }
    await enqueueRecomputes(trx, parents);
    if (added.length > 0 || removed.length > 0) {
      await trx
        .updateTable('ebooks')
        .set({ version: sql<number>`version + 1` })
        .where('id', '=', id)
        .execute();
    }
    await catalogAudit(trx, request, {
      action: 'ebook.set_targets',
      targetType: 'ebook',
      targetId: id,
      details: { added: added.length, removed: removed.length },
    });
    return listCatalogEbookTargets(trx, request, id);
  });
}

/** O ebook passaria de `targetsPerEbook` vínculos, contados todos os tipos. */
function targetsLimitExceeded() {
  return catalogLimitExceeded(
    'targetsPerEbook',
    `O ebook aceita até ${CATALOG_LIMITS.targetsPerEbook} vínculos.`,
  );
}

export interface EbookTargetInput {
  /** `course` ou `lesson`. */
  targetType: unknown;
  targetId: unknown;
}

/**
 * Trava o ebook e resolve o alvo de um vínculo só (`ebook.link`). Ebook inexistente: `404`; alvo
 * inexistente: `422` `catalog_item_not_found`; alvo de curso alheio ao instrutor: `404`.
 */
async function loadEbookLink(
  trx: Database,
  request: CatalogRequest,
  ebookId: unknown,
  input: EbookTargetInput,
): Promise<{ ebookId: string; link: CatalogEbookTarget; linked: boolean }> {
  const id = assertCatalogId(ebookId, 'Ebook');
  requireCatalogAction(request, 'ebook.link', {
    action: 'ebook.set_targets',
    target: { type: 'ebook', id },
  });
  const errors = new FieldErrors();
  const link: CatalogEbookTarget = {
    targetType: readEnum(errors, input.targetType, 'path.targetType', EBOOK_SINGLE_TARGET_TYPES),
    targetId: readId(errors, input.targetId, 'path.targetId'),
  };
  errors.throwIfAny();
  const ebook = await findProduct(trx, 'ebook', id, { forUpdate: true });
  if (!ebook) throw notFound('Ebook não encontrado.');
  const resolved = (await resolveTargets(trx, [link])).get(`${link.targetType}:${link.targetId}`);
  if (!resolved) {
    throw catalogUnprocessable('catalog_item_not_found', 'Alvo do vínculo não existe.', [
      { path: 'path.targetId', message: 'Alvo não encontrado.' },
    ]);
  }
  if (!reachable(request, resolved)) throw notFound('Curso ou aula não encontrado.');
  const existing = await trx
    .selectFrom('productEbooks')
    .select('ebookId')
    .where('ebookId', '=', id)
    .where('targetType', '=', link.targetType)
    .where('targetId', '=', link.targetId)
    .executeTakeFirst();
  return { ebookId: id, link, linked: existing !== undefined };
}

/** O que toda mudança de um vínculo grava: `version` do ebook, recálculo do pai e auditoria. */
async function afterEbookLinkChange(
  trx: Database,
  request: CatalogRequest,
  ebookId: string,
  link: CatalogEbookTarget,
  change: 'added' | 'removed',
): Promise<void> {
  await trx
    .updateTable('ebooks')
    .set({ version: sql<number>`version + 1` })
    .where('id', '=', ebookId)
    .execute();
  const parent = await recomputeParentOfTarget(trx, link);
  if (parent) await enqueueRecomputes(trx, [parent]);
  await catalogAudit(trx, request, {
    action: 'ebook.set_targets',
    targetType: 'ebook',
    targetId: ebookId,
    details: {
      added: change === 'added' ? 1 : 0,
      removed: change === 'removed' ? 1 : 0,
      target: link,
    },
  });
}

/**
 * `PUT /ebooks/{id}/targets/{targetType}/{targetId}` (`ebook.link`): vincula o ebook a um curso
 * ou a uma aula, sem tocar nos outros vínculos (spec 009, "Ebooks vinculados"). Idempotente:
 * vínculo que já existe não grava nem audita. Alvo inexistente: `422` `catalog_item_not_found`;
 * alvo de curso alheio ao instrutor: `404`; o 501º vínculo do ebook: `422`
 * `catalog_limit_exceeded` (`targetsPerEbook`). Avança o `version` do ebook, enfileira
 * `entitlement.recompute` do curso (o da aula, em vínculo `lesson`) na mesma transação e grava
 * `ebook.set_targets` com o vínculo acrescentado. Não recebe `version`.
 */
export async function linkEbookTarget(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
  input: EbookTargetInput,
): Promise<void> {
  await catalogWrite(db, request, async (trx) => {
    const { ebookId: id, link, linked } = await loadEbookLink(trx, request, ebookId, input);
    if (linked) return;
    const total = await trx
      .selectFrom('productEbooks')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('ebookId', '=', id)
      .executeTakeFirstOrThrow();
    if (total.count >= CATALOG_LIMITS.targetsPerEbook) throw targetsLimitExceeded();
    await trx
      .insertInto('productEbooks')
      .values({ ebookId: id, ...link })
      .execute();
    await afterEbookLinkChange(trx, request, id, link, 'added');
  });
}

/**
 * `DELETE /ebooks/{id}/targets/{targetType}/{targetId}` (`ebook.link`): desfaz um vínculo do
 * ebook, sem tocar nos outros. Idempotente: vínculo que não existe não grava nem audita. Os
 * mesmos erros de alvo de `linkEbookTarget`. Avança o `version` do ebook, enfileira o recálculo
 * do curso e grava `ebook.set_targets` com o vínculo removido. Não recebe `version`.
 */
export async function unlinkEbookTarget(
  db: Database,
  request: CatalogRequest,
  ebookId: unknown,
  input: EbookTargetInput,
): Promise<void> {
  await catalogWrite(db, request, async (trx) => {
    const { ebookId: id, link, linked } = await loadEbookLink(trx, request, ebookId, input);
    if (!linked) return;
    await trx
      .deleteFrom('productEbooks')
      .where('ebookId', '=', id)
      .where('targetType', '=', link.targetType)
      .where('targetId', '=', link.targetId)
      .execute();
    await afterEbookLinkChange(trx, request, id, link, 'removed');
  });
}
