import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeRefund, FakePaymentProvider } from '@nuva-edu/core';
import { connect, parseDatabaseUrl } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, type CallOptions, callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';
import {
  CURRENCY,
  checkoutOrder,
  createPaidCourseAs,
  createPaidEbookAs,
  makeBuyer,
  SAMPLE_CNPJ,
  SAMPLE_CPF,
} from './fixtures.ts';

// Exportação CSV de vendas (`GET /api/v1/orders/export.csv`, spec 011, RNF-04 e "Consulta e
// exportação"; specs 008, 028 e 033):
// - exclusiva do `admin` (`sales.export`); `manager`, `instructor` e `student` recebem `403`
//   `permission_denied` com `outcome = denied` em `audit_log`;
// - leitura sensível auditada (`sales.export`), sem conteúdo, filtros nem `tax_id` nos logs;
// - UTF-8 com BOM, separador `;`, CRLF, valores decimais com vírgula e as 19 colunas da spec 011;
// - fluxo contínuo sobre 50.000 itens de pedido em menos de 30 s sem materializar em memória.

const EXPECTED_HEADER =
  'order_id;order_number;created_at;paid_at;status;buyer_name;buyer_email;tax_id_type;tax_id;product_type;product_title;unit_price;discount;paid_amount;refunded_amount;coupon_code;payment_method;provider;provider_payment_id';

const provider = new FakePaymentProvider({ currency: CURRENCY });
let database: Awaited<ReturnType<typeof createIsolatedDatabase>>;
let test: TestApp;

afterAll(async () => {
  await test?.close();
  await database?.drop();
});

let admin: Actor;
let manager: Actor;
let instructor: Actor;
let student: Actor;

beforeAll(async () => {
  // Cada fake começa com os mesmos identificadores de cobrança e adesão.
  database = await createIsolatedDatabase();
  test = createTestApp(
    { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
    { paymentProvider: provider },
  );
  [admin, manager, instructor, student] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
    createActor(test, 'student'),
  ]);
});

const call = (options: CallOptions) => callAs(test, options);

describe('exportação CSV de vendas', () => {
  it('exporta com BOM, ponto e vírgula, decimais com vírgula, todas as colunas da spec 011, auditoria e logs limpos', async () => {
    const course = await createPaidCourseAs(test, admin, {
      title: 'Curso CSV; "Especial"',
      priceCents: 19_990,
    });
    const ebook = await createPaidEbookAs(test, admin, {
      title: 'Ebook CSV',
      priceCents: 5_000,
    });
    const couponCode = 'CSV10';
    await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: couponCode, kind: 'percent', percentOff: 10 },
    });

    const buyer = await makeBuyer(test, {
      fullName: 'Ana; Compradora',
      taxIdType: 'cpf',
      taxId: SAMPLE_CPF,
      emailPrefix: 'ana-csv',
    });
    const purchased = await checkoutOrder(test.db, provider, {
      buyer,
      items: [
        { productType: 'course', productId: course.id },
        { productType: 'ebook', productId: ebook.id },
      ],
      couponCode,
      approve: true,
      method: 'card',
      now: new Date('2026-06-15T14:30:00.000Z'),
    });

    // Reembolso parcial de R$ 50,00 no curso para exercitar `refunded_amount`.
    const detail = (
      await call({ method: 'GET', url: `/api/v1/orders/${purchased.orderId}`, as: admin })
    ).json();
    const courseItem = detail.items.find(
      (item: { productId: string }) => item.productId === course.id,
    );
    const refundRes = await call({
      method: 'POST',
      url: `/api/v1/orders/${purchased.orderId}/refunds`,
      as: admin,
      payload: {
        reason: 'Ajuste parcial',
        items: [{ orderItemId: courseItem.id, amountCents: 5_000 }],
      },
    });
    await executeRefund(test.db, provider, refundRes.json().id);

    const secretQuery = buyer.email;
    const response = await call({
      method: 'GET',
      url: `/api/v1/orders/export.csv?q=${encodeURIComponent(secretQuery)}&status=partially_refunded`,
      as: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="vendas-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');

    const body = response.body;
    expect(body.startsWith('\uFEFF')).toBe(true);
    expect(body.includes('\r\n')).toBe(true);

    const lines = body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(EXPECTED_HEADER);
    expect(lines).toHaveLength(3);

    const joinedRows = lines.slice(1).join('\n');
    expect(joinedRows).toContain(purchased.orderId);
    expect(joinedRows).toContain(`;${purchased.orderNumber};`);
    expect(joinedRows).toContain('2026-06-15T14:30:00.000Z');
    expect(joinedRows).toContain('partially_refunded');
    expect(joinedRows).toContain('"Ana; Compradora"');
    expect(joinedRows).toContain(buyer.email);
    expect(joinedRows).toContain(`;cpf;${SAMPLE_CPF};`);
    expect(joinedRows).toContain('"Curso CSV; ""Especial"""');
    // Preço R$ 199,90, desconto 10% = R$ 19,99, pago = R$ 179,91, reembolsado = R$ 50,00.
    expect(joinedRows).toContain(';199,90;19,99;179,91;50,00;CSV10;card;fake;');
    // Ebook: R$ 50,00, desconto R$ 5,00, pago R$ 45,00, reembolsado R$ 0,00.
    expect(joinedRows).toContain(';50,00;5,00;45,00;0,00;CSV10;card;fake;');
    expect(joinedRows).toContain(purchased.providerPaymentId as string);

    // Auditoria da leitura sensível (`sales.export`), sem gravar o valor de `q`.
    const exportsAudit = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('actorUserId', '=', admin.id)
      .where('action', '=', 'sales.export')
      .where('outcome', '=', 'ok')
      .execute();
    expect(exportsAudit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(exportsAudit)).not.toContain(secretQuery);

    // Nem o `tax_id`, nem o conteúdo do CSV, nem o valor do filtro aparecem nos logs.
    const logs = test.logText();
    expect(logs).not.toContain(SAMPLE_CPF);
    expect(logs).not.toContain(SAMPLE_CNPJ);
    expect(logs).not.toContain(secretQuery);
    expect(logs).not.toContain('Curso CSV');
  });

  it('gerente, instrutor e aluno recebem 403 permission_denied auditado no CSV; filtro inválido responde 400', async () => {
    for (const actor of [manager, instructor, student]) {
      const response = await call({
        method: 'GET',
        url: '/api/v1/orders/export.csv',
        as: actor,
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ code: 'permission_denied' });

      const denials = await deniedBy(test, actor.id);
      const exportDenial = denials.find(
        (entry) =>
          (entry.details as { operation?: string; permission?: string }).operation ===
          'exportOrdersCsv',
      );
      expect(exportDenial).toBeDefined();
      expect(exportDenial?.actorRole).toBe(actor.role);
      expect(exportDenial?.details).toMatchObject({
        permission: 'sales.export',
        operation: 'exportOrdersCsv',
      });
    }

    const badFilter = await call({
      method: 'GET',
      url: '/api/v1/orders/export.csv?productType=course',
      as: admin,
    });
    expect(badFilter.statusCode).toBe(400);
    expect(badFilter.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('exporta 50.000 itens de pedido em streaming contínuo sem materializar tudo em memória (< 30 s)', async () => {
    const isolated = await createIsolatedDatabase();
    const streamingTest = createTestApp(
      { DATABASE_URL: isolated.url },
      { listenUserEvents: false },
    );
    try {
      const isoAdmin = await createActor(streamingTest, 'admin');
      const buyer = await makeBuyer(streamingTest, {
        fullName: 'Comprador Lote',
        taxIdType: 'cnpj',
        taxId: SAMPLE_CNPJ,
      });

      // 5.000 pedidos × 10 itens = 50.000 itens no banco real.
      const client = await connect(parseDatabaseUrl(isolated.url));
      try {
        await client.query(
          `
            WITH products AS (
              SELECT uuidv7() AS product_id, g AS idx
                FROM generate_series(1, 10) AS g
            ),
            inserted_orders AS (
              INSERT INTO orders (
                user_id, status, subtotal_cents, discount_cents, total_cents, currency,
                buyer_name, buyer_tax_id_type, buyer_tax_id, provider, paid_at, created_at
              )
              SELECT
                $1::uuid,
                'paid',
                100000,
                0,
                100000,
                'BRL',
                'Comprador Lote',
                'cnpj',
                $2::text,
                'fake',
                timestamptz '2026-07-01T00:00:00Z' + (n || ' seconds')::interval,
                timestamptz '2026-07-01T00:00:00Z' + (n || ' seconds')::interval
              FROM generate_series(1, 5000) AS n
              RETURNING id
            )
            INSERT INTO order_items (
              order_id, product_type, product_id, title_snapshot,
              unit_price_cents, discount_cents, paid_cents, refunded_cents
            )
            SELECT
              o.id,
              'course',
              p.product_id,
              'Curso em Lote ' || p.idx,
              10000,
              0,
              10000,
              0
            FROM inserted_orders o
            CROSS JOIN products p
            `,
          [buyer.id, SAMPLE_CNPJ],
        );
      } finally {
        await client.end();
      }

      await streamingTest.app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = streamingTest.app.server.address() as AddressInfo;

      const startedAt = performance.now();
      const baselineHeap = process.memoryUsage().heapUsed;
      let peakHeapDelta = 0;

      const stats = await new Promise<{
        statusCode: number;
        transferEncoding: string | undefined;
        contentLength: string | undefined;
        chunkCount: number;
        lineCount: number;
        firstLine: string;
        startsWithBom: boolean;
      }>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/api/v1/orders/export.csv',
            method: 'GET',
            headers: { cookie: `nuva_admin_session=${isoAdmin.cookie}` },
          },
          (res) => {
            res.setEncoding('utf8');
            let chunkCount = 0;
            let newlineCount = 0;
            let startsWithBom = false;
            let headerBuffer = '';
            let firstLine = '';

            res.on('data', (chunk: string) => {
              chunkCount += 1;
              if (chunkCount === 1) {
                startsWithBom = chunk.startsWith('\uFEFF');
              }
              if (firstLine === '') {
                headerBuffer += chunk;
                const idx = headerBuffer.indexOf('\r\n');
                if (idx !== -1) {
                  firstLine = headerBuffer.slice(startsWithBom ? 1 : 0, idx);
                  headerBuffer = '';
                }
              }
              for (let i = 0; i < chunk.length; i += 1) {
                if (chunk.charCodeAt(i) === 10) {
                  newlineCount += 1;
                }
              }
              const delta = process.memoryUsage().heapUsed - baselineHeap;
              if (delta > peakHeapDelta) {
                peakHeapDelta = delta;
              }
            });
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode ?? 0,
                transferEncoding: res.headers['transfer-encoding'],
                contentLength: res.headers['content-length'],
                chunkCount,
                lineCount: newlineCount,
                firstLine,
                startsWithBom,
              });
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end();
      });

      const elapsedMs = performance.now() - startedAt;
      expect(stats.statusCode).toBe(200);
      // Streaming chunked: sem `Content-Length` pré-materializado e com dezenas de blocos.
      expect(stats.contentLength).toBeUndefined();
      expect(stats.transferEncoding).toBe('chunked');
      expect(stats.startsWithBom).toBe(true);
      expect(stats.firstLine).toBe(EXPECTED_HEADER);
      // 1 cabeçalho + 50.000 itens = 50.001 linhas terminadas em CRLF.
      expect(stats.lineCount).toBe(50_001);
      expect(stats.chunkCount).toBeGreaterThan(50);
      expect(elapsedMs).toBeLessThan(30_000);
      // Memória adicional permanece baixa (sem acumular o CSV inteiro no processo).
      expect(peakHeapDelta).toBeLessThan(64 * 1024 * 1024);
      expect(streamingTest.logText()).not.toContain(SAMPLE_CNPJ);
    } finally {
      await streamingTest.close();
      await isolated.drop();
    }
  }, 45_000);
});
