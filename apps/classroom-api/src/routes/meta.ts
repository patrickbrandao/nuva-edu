import type { FastifyInstance } from '@nuva-edu/api-kit';
import type { Config } from '@nuva-edu/core';
import { installationMeta } from '../meta.ts';

export interface MetaRouteOptions {
  config: Pick<Config, 'currency' | 'locale' | 'authProviders'>;
  version: string;
}

/** `GET /api/v1/meta`: dados públicos da instalação, sem sessão (spec 004, RF-02). */
export function registerMetaRoutes(app: FastifyInstance, options: MetaRouteOptions): void {
  app.operation('getMeta', () => installationMeta(options.config, options.version));
}
