import { crc32, deflateSync } from 'node:zlib';
import { type Actor, callAs } from './actors.ts';
import type { TestApp } from './helpers.ts';

// Envio de imagem como o site faz (spec 029, "Fluxo de envio"): os testes do envio e os da
// identidade da escola montam o mesmo `multipart/form-data`.

/** PNG em tons de cinza, todo preto. */
export function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits por amostra
  ihdr.writeUInt8(0, 9); // tons de cinza
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Cada linha: o byte do filtro e um byte por pixel.
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BOUNDARY = 'limite-de-teste';

/** Cabeçalhos de um `multipart/form-data` montado por `multipart`. */
export const MULTIPART = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

/** Corpo `multipart/form-data` com as partes na ordem dada. */
export function multipart(
  parts: Array<{ name: string; value: string | Buffer; filename?: string }>,
) {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: image/png`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`));
    chunks.push(typeof part.value === 'string' ? Buffer.from(part.value) : part.value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

export interface UploadOptions {
  /** Finalidade do envio; padrão `product_cover`. */
  purpose?: string;
  /** Bytes do arquivo; padrão um PNG 32×18. */
  file?: Buffer;
  /** Outra instância da API (o teste de sobrecarga usa a própria). */
  app?: TestApp;
  /** `null` omite o `X-CSRF-Token`. */
  csrf?: null;
}

/** `POST /api/v1/images` com `purpose` e `file`, autenticado como o ator. */
export function uploadImage(test: TestApp, as: Actor, options: UploadOptions = {}) {
  return callAs(options.app ?? test, {
    method: 'POST',
    url: '/api/v1/images',
    as,
    headers: MULTIPART,
    payload: multipart([
      { name: 'purpose', value: options.purpose ?? 'product_cover' },
      { name: 'file', value: options.file ?? png(32, 18), filename: 'capa.png' },
    ]),
    ...(options.csrf === null ? { csrf: null } : {}),
  });
}
