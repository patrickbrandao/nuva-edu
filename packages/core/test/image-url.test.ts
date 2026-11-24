import { describe, expect, it } from 'vitest';
import {
  imagePath,
  isImageId,
  SCHOOL_LOGO_DEFAULT_VARIANT,
  SCHOOL_LOGO_VARIANTS,
  schoolLogoUrl,
} from '../src/index.ts';

const ID = '019aa3f2-7b1c-7e55-9a10-5299822472aa';

describe('caminho de entrega das imagens (spec 029)', () => {
  it('monta /api/v1/images/{image_id}/{variant}.webp, com o id em minúsculas', () => {
    expect(imagePath(ID, 480)).toBe(`/api/v1/images/${ID}/480.webp`);
    expect(imagePath(ID.toUpperCase(), 64)).toBe(`/api/v1/images/${ID}/64.webp`);
  });

  it.each([
    ['', 64],
    ['../../etc/passwd', 64],
    [`${ID}/x`, 64],
    [ID, 0],
    [ID, -64],
    [ID, 64.5],
    [ID, Number.NaN],
  ])('recusa imagePath(%j, %j)', (id, variant) => {
    expect(() => imagePath(id, variant)).toThrow(TypeError);
  });

  it('reconhece UUID em texto', () => {
    expect(isImageId(ID)).toBe(true);
    expect(isImageId(ID.toUpperCase())).toBe(true);
    expect(isImageId(ID.replaceAll('-', ''))).toBe(false);
    expect(isImageId(null)).toBe(false);
    expect(isImageId(42)).toBe(false);
  });

  it('logoUrl: nulo sem logotipo; senão o caminho na variante pedida', () => {
    expect(SCHOOL_LOGO_VARIANTS).toEqual([64, 256, 512]);
    expect(SCHOOL_LOGO_DEFAULT_VARIANT).toBe(256);
    expect(schoolLogoUrl(null)).toBeNull();
    expect(schoolLogoUrl(null, 512)).toBeNull();
    expect(schoolLogoUrl(ID)).toBe(`/api/v1/images/${ID}/256.webp`);
    expect(schoolLogoUrl(ID, 512)).toBe(`/api/v1/images/${ID}/512.webp`);
    expect(() => schoolLogoUrl('logo.png')).toThrow(TypeError);
  });
});
