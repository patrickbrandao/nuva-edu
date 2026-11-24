import { readPackageVersion } from '@nuva-edu/api-kit';

/** Versão instalada, exibida em `/api/v1/meta`: a do `package.json` deste serviço. */
export function readServiceVersion(): string {
  return readPackageVersion(new URL('../package.json', import.meta.url));
}
