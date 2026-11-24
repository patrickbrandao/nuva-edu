import { describe, expect, it } from 'vitest';
import { readServiceVersion } from '../src/meta.ts';

describe('readServiceVersion', () => {
  it('lê a versão do package.json do serviço', () => {
    expect(readServiceVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
