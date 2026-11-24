import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createReadinessLogger,
  type ReadinessChecks,
  runReadinessChecks,
} from '@nuva-edu/api-kit/health';
import type { Logger } from '@nuva-edu/core';
import { METRICS_CONTENT_TYPE } from './metrics.ts';

export interface HttpServerOptions {
  logger: Logger;
  /**
   * Verificações do `/readyz`, pelo nome que aparece em `checks`. Lançar ou passar do prazo
   * conta como falha.
   */
  checks: ReadinessChecks;
  /** Texto do `/metrics`, no formato do Prometheus. */
  metrics: () => Promise<string>;
}

export interface HttpServer {
  /** Devolve a porta em que ficou escutando (útil com porta 0 nos testes). */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

/**
 * HTTP interno do worker (spec 033): `/healthz` (vivo, sem tocar no banco), `/readyz` (banco,
 * migrations e laço da fila) e `/metrics`. Sem rota de negócio; não é roteado pelo proxy.
 */
export function createHttpServer(options: HttpServerOptions): HttpServer {
  const { logger } = options;
  // Só a mudança de estado é registrada, com o motivo; não cada sondagem.
  const logReadiness = createReadinessLogger(logger);

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    if (path === '/healthz') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (path === '/readyz') {
      void runReadinessChecks(options.checks).then((report) => {
        logReadiness(report);
        // Os motivos ficam no log: a resposta leva só `status` e `checks`.
        sendJson(response, report.status === 'ready' ? 200 : 503, {
          status: report.status,
          checks: report.checks,
        });
      });
      return;
    }
    if (path === '/metrics') {
      options.metrics().then(
        (text) => {
          response.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
          response.end(text);
        },
        (error: unknown) => {
          logger.error({ err: error }, 'Falha ao montar as métricas');
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('erro ao montar as métricas\n');
        },
      );
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('não encontrado\n');
  });

  return {
    listen: (port, host = '0.0.0.0') =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
