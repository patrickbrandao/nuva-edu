// Processamento das imagens enviadas com `sharp` (spec 029): tipo detectado pelo conteúdo,
// limites de dimensão, variantes cortadas, WebP sem metadados e a regra de qualidade.

import { createHash } from 'node:crypto';
import sharp, { type Metadata, type Sharp } from 'sharp';
import {
  IMAGE_MAX_INPUT_PIXELS,
  IMAGE_MAX_INPUT_SIDE,
  IMAGE_MAX_VARIANT_BYTES,
  IMAGE_MAX_VARIANT_SIDE,
  IMAGE_VARIANT_SPECS,
  IMAGE_WEBP_QUALITIES,
  type ImagePurpose,
  imageDimensionsExceeded,
  imagePayloadTooLarge,
  imageTooHeavy,
  imageTypeUnsupported,
  imageUploadMaxBytes,
} from './rules.ts';

/** Formatos aceitos na entrada (RF-01). */
export type ImageInputFormat = 'jpeg' | 'png' | 'webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(data: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (data.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => data[offset + index] === byte);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/**
 * Formato pela assinatura do conteúdo (nunca pela extensão nem pelo `Content-Type`): JPEG
 * (`FF D8 FF`), PNG (8 bytes fixos) ou WebP (`RIFF....WEBP`). Qualquer outra coisa, `null`.
 */
export function detectImageFormat(data: Uint8Array): ImageInputFormat | null {
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  if (startsWith(data, PNG_SIGNATURE)) {
    return 'png';
  }
  if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) {
    return 'webp';
  }
  return null;
}

/** Uma variante pronta para gravar em `image_variants`. */
export interface ProcessedImageVariant {
  /**
   * Nome da variante na URL e valor de `image_variants.width`: a largura nas finalidades com
   * corte e o maior lado nas de proporção original (numa variante retrato não é a largura real).
   */
  width: number;
  /** Altura real da variante. */
  height: number;
  /** `octet_length(data)`. */
  bytes: number;
  /** SHA-256 de `data` em hexadecimal minúsculo: o `ETag` da entrega. */
  sha256: string;
  /** Qualidade WebP usada (80, 70, 60 ou 50). */
  quality: number;
  data: Buffer;
}

export interface ProcessedImage {
  format: ImageInputFormat;
  /** Dimensões da imagem recebida, já na orientação do EXIF. */
  originalWidth: number;
  originalHeight: number;
  variants: ProcessedImageVariant[];
}

export interface ProcessImageOptions {
  /** `config.images.maxUploadMb` (`NUVA_IMAGE_MAX_UPLOAD_MB`). Padrão: 5. */
  maxUploadMb?: number;
  /** Teto de cada variante. Padrão: 400 KB (RNF-03); menor só em teste. */
  maxVariantBytes?: number;
}

function variantHeightFor(width: number, aspect: number): number {
  return Math.max(1, Math.round(width / aspect));
}

/**
 * Dimensões de uma variante de proporção original (spec 029, "Variantes de proporção original"):
 * o maior lado do arquivo gerado é o nome da variante e o outro sai da proporção, arredondado,
 * de 1 até o nome.
 */
function originalVariantSize(
  originalWidth: number,
  originalHeight: number,
  side: number,
): { width: number; height: number } {
  if (originalWidth >= originalHeight) {
    const height = Math.min(side, Math.max(1, Math.round((side * originalHeight) / originalWidth)));
    return { width: side, height };
  }
  const width = Math.min(side, Math.max(1, Math.round((side * originalWidth) / originalHeight)));
  return { width, height: side };
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Valida e processa um envio: confere tamanho, tipo pelo conteúdo e dimensões (antes de
 * decodificar os pixels), corta ao centro na proporção das finalidades com corte, redimensiona
 * para o nome de cada variante — a largura exata nas de proporção fixa e o maior lado, sem corte,
 * nas de proporção original —, remove os metadados e grava em WebP com qualidade 80, descendo de
 * 10 em 10 até 50 enquanto a variante passar do teto. Amplia quando o original é menor. Lança os
 * `DomainError` da spec 029.
 */
export async function processImage(
  data: Uint8Array,
  purpose: ImagePurpose,
  options: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  const maxUploadMb = options.maxUploadMb ?? 5;
  const maxVariantBytes = options.maxVariantBytes ?? IMAGE_MAX_VARIANT_BYTES;
  const spec = IMAGE_VARIANT_SPECS[purpose];
  if (spec === undefined) {
    throw new TypeError(`processImage: finalidade ainda não implementada: ${purpose}.`);
  }
  if (data.length > imageUploadMaxBytes(maxUploadMb)) {
    throw imagePayloadTooLarge(maxUploadMb);
  }
  const format = detectImageFormat(data);
  if (format === null) {
    throw imageTypeUnsupported();
  }

  const input = { limitInputPixels: IMAGE_MAX_INPUT_PIXELS, failOn: 'error' as const };
  let metadata: Metadata;
  try {
    // Só o cabeçalho; o limite de pixels é conferido abaixo, com o erro certo (422).
    // `animated` faz o cabeçalho contar os quadros (`pages`) de um WebP animado.
    metadata = await sharp(data, {
      failOn: 'error',
      limitInputPixels: false,
      animated: true,
    }).metadata();
  } catch (error) {
    throw imageTypeUnsupported('O arquivo não é uma imagem válida.', error);
  }
  if (metadata.format !== format) {
    throw imageTypeUnsupported();
  }
  if ((metadata.pages ?? 1) > 1) {
    throw imageTypeUnsupported('Imagens animadas não são aceitas.');
  }
  const { width, height } = metadata;
  if (Math.max(width, height) > IMAGE_MAX_INPUT_SIDE || width * height > IMAGE_MAX_INPUT_PIXELS) {
    throw imageDimensionsExceeded();
  }
  const swapped = (metadata.orientation ?? 1) >= 5;
  const originalWidth = swapped ? height : width;
  const originalHeight = swapped ? width : height;

  // Nas finalidades com corte todas as variantes têm a mesma proporção; nas de proporção original
  // cada uma mantém a proporção da entrada, com o maior lado igual ao nome.
  const sizeOf = (side: number): { width: number; height: number } =>
    spec.aspect === undefined
      ? originalVariantSize(originalWidth, originalHeight, side)
      : { width: side, height: variantHeightFor(side, spec.aspect) };

  // Decodifica uma vez, já na orientação do EXIF, reduz (ou amplia) para a maior variante — com
  // corte nas finalidades de proporção fixa — e as menores partem desses pixels.
  const largestSide = Math.max(...spec.widths);
  const largest = sizeOf(largestSide);
  let base: Sharp;
  try {
    const raw = await sharp(data, { ...input, autoOrient: true })
      .resize(largest.width, largest.height, {
        fit: spec.aspect === undefined ? 'fill' : 'cover',
        position: 'centre',
        withoutEnlargement: false,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    base = sharp(raw.data, {
      raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels },
    });
  } catch (error) {
    throw imageTypeUnsupported('O arquivo não é uma imagem válida.', error);
  }

  const variants: ProcessedImageVariant[] = [];
  for (const variantName of spec.widths) {
    const size = sizeOf(variantName);
    if (Math.max(size.width, size.height) > IMAGE_MAX_VARIANT_SIDE) {
      throw new TypeError('processImage: variante acima de 1600 px na configuração.');
    }
    const resized =
      variantName === largestSide
        ? base.clone()
        : base.clone().resize(size.width, size.height, { fit: 'fill' });
    let encoded: Buffer | undefined;
    let quality = 0;
    for (const candidate of IMAGE_WEBP_QUALITIES) {
      // Sem `keepMetadata`: o `sharp` grava sem EXIF, GPS, XMP, IPTC nem perfil ICC.
      const output = await resized.clone().webp({ quality: candidate }).toBuffer();
      if (output.length <= maxVariantBytes) {
        encoded = output;
        quality = candidate;
        break;
      }
    }
    if (encoded === undefined) {
      throw imageTooHeavy();
    }
    variants.push({
      width: variantName,
      height: size.height,
      bytes: encoded.length,
      sha256: sha256Hex(encoded),
      quality,
      data: encoded,
    });
  }

  return {
    format,
    originalWidth,
    originalHeight,
    variants,
  };
}
