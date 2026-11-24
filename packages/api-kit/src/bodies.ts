import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import busboyModule, { type BusboyConstructor, type BusboyInstance } from '@fastify/busboy';
import formbody from '@fastify/formbody';
import { type DomainError, validationFailed } from '@nuva-edu/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { payloadTooLarge } from './errors.ts';

// O pacote é CommonJS: sob NodeNext o `default` pode vir embrulhado.
const Busboy = ((busboyModule as unknown as { default?: unknown }).default ??
  busboyModule) as unknown as BusboyConstructor;

export const JSON_MEDIA_TYPE = 'application/json';
export const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded';
export const MULTIPART_MEDIA_TYPE = 'multipart/form-data';

/** Teto de campos de texto num envio multipart; o contrato diz quais são aceitos. */
const MULTIPART_MAX_FIELDS = 50;

/** O arquivo de um envio `multipart/form-data`, já lido na memória (até o limite da operação). */
export class UploadedFile {
  readonly field: string;
  /** Nome informado pelo cliente; só para exibição, nunca para caminho em disco. */
  readonly filename: string;
  /** Tipo declarado pelo cliente; não é confiável (a API detecta o tipo pelo conteúdo). */
  readonly mimeType: string;
  readonly data: Buffer;

  constructor(field: string, filename: string, mimeType: string, data: Buffer) {
    this.field = field;
    this.filename = filename;
    this.mimeType = mimeType;
    this.data = data;
  }

  get size(): number {
    return this.data.length;
  }
}

/** Corpo `multipart/form-data` lido: campos de texto e, no máximo, um arquivo. */
export type MultipartBody = Readonly<Record<string, string | UploadedFile>>;

/**
 * Liga os leitores de corpo além do JSON: `application/x-www-form-urlencoded`
 * (`@fastify/formbody`, retorno da Apple) e `multipart/form-data` (envio de imagem). Os dois
 * respeitam o `bodyLimit` da operação.
 */
export function registerBodyParsers(app: FastifyInstance): void {
  // Sem `bodyLimit` próprio: vale o da operação, ou o padrão do serviço.
  app.register(formbody);
  app.addContentTypeParser(
    MULTIPART_MEDIA_TYPE,
    (request: FastifyRequest, payload: IncomingMessage) =>
      readMultipart(request.headers, payload, request.routeOptions.bodyLimit),
  );
}

/**
 * Lê um corpo `multipart/form-data` (spec 029): os campos de texto vêm antes do arquivo, há um
 * arquivo só e nenhum campo se repete; o que fugir disso é `400 validation_failed`. Passou do
 * `limit` (o `bodyLimit` da operação), `413 payload_too_large` na hora: pelo `Content-Length`,
 * antes de ler qualquer byte, ou, sem ele, assim que a contagem passar, sem ler o resto.
 */
export function readMultipart(
  headers: IncomingHttpHeaders,
  payload: Readable,
  limit: number,
): Promise<MultipartBody> {
  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(tooLarge(limit));
  }
  return new Promise((resolve, reject) => {
    let busboy: BusboyInstance;
    try {
      busboy = Busboy({
        headers: headers as IncomingHttpHeaders & { 'content-type': string },
        limits: {
          fileSize: limit,
          fieldSize: limit,
          files: 1,
          fields: MULTIPART_MAX_FIELDS,
        },
      });
    } catch {
      reject(malformed('O corpo multipart não tem boundary válido.'));
      return;
    }

    const entries = new Map<string, string | UploadedFile>();
    let fileStarted = false;
    let fileDone = true;
    let parserDone = false;
    let settled = false;
    let received = 0;

    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        fail(tooLarge(limit));
      }
    };
    const onPayloadError = (error: Error) => fail(error);

    const cleanup = () => {
      payload.off('data', onData);
      payload.off('error', onPayloadError);
      payload.unpipe(busboy);
      busboy.removeAllListeners();
      // Sem erro pendente: o resto do corpo não é lido; a resposta fecha a conexão.
      busboy.on('error', () => {});
    };
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const finishIfDone = () => {
      if (!settled && parserDone && fileDone) {
        settled = true;
        cleanup();
        resolve(Object.fromEntries(entries));
      }
    };

    busboy.on(
      'field',
      (name: string, value: string, nameTruncated: boolean, valueTruncated: boolean) => {
        if (nameTruncated) {
          fail(fieldError('body', 'Nome de campo longo demais.'));
        } else if (valueTruncated) {
          fail(tooLarge(limit));
        } else if (fileStarted) {
          fail(fieldError(`body.${name}`, 'Os campos de texto vêm antes do arquivo.'));
        } else if (entries.has(name)) {
          fail(fieldError(`body.${name}`, 'Campo repetido.'));
        } else {
          entries.set(name, value);
        }
      },
    );

    busboy.on('file', (name, stream, filename, _encoding, mimeType) => {
      if (entries.has(name)) {
        stream.resume();
        fail(fieldError(`body.${name}`, 'Campo repetido.'));
        return;
      }
      fileStarted = true;
      fileDone = false;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => fail(tooLarge(limit)));
      stream.on('error', (error: Error) => fail(error));
      stream.on('end', () => {
        if (stream.truncated) {
          fail(tooLarge(limit));
          return;
        }
        entries.set(name, new UploadedFile(name, filename ?? '', mimeType, Buffer.concat(chunks)));
        fileDone = true;
        finishIfDone();
      });
    });

    busboy.on('filesLimit', () => fail(fieldError('body', 'Envie um arquivo só.')));
    busboy.on('fieldsLimit', () => fail(fieldError('body', 'Campos demais.')));
    busboy.on('error', () => fail(malformed('O corpo multipart está malformado.')));
    busboy.on('finish', () => {
      parserDone = true;
      finishIfDone();
    });

    payload.on('data', onData);
    payload.on('error', onPayloadError);
    payload.pipe(busboy);
  });
}

function tooLarge(limit: number): DomainError {
  return payloadTooLarge(`O corpo da requisição passa do limite de ${formatBytes(limit)}.`);
}

function fieldError(path: string, message: string): DomainError {
  return validationFailed([{ path, message }], 'A requisição não confere com o contrato da API.');
}

function malformed(message: string): DomainError {
  return validationFailed([{ path: 'body', message }], message);
}

/** `5242880` → `5 MB`; `262144` → `256 KB`. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MB`;
  }
  if (bytes >= 1024 && bytes % 1024 === 0) {
    return `${bytes / 1024} KB`;
  }
  return `${bytes} bytes`;
}
