import { describe, expect, it } from 'vitest';
import {
  assertContentUrl,
  CATALOG_LIMITS,
  canUploadImagePurpose,
  checkContentUrl,
  classifyVideoProvider,
  DomainError,
  IMAGE_VARIANT_SPECS,
  parseVideoUrl,
  type VideoProvider,
} from '../src/index.ts';

// Spec 009, "Vídeo e links externos": validação de URL e classificação do provedor (com a P5 da
// tarefa 400). Funções puras: a URL nunca é buscada.

describe('validação de URL de conteúdo', () => {
  it.each([
    ['https://exemplo.com/video.mp4'],
    ['https://www.youtube.com/watch?v=abc123'],
    ['http://classroom.localhost:8080/arquivo.pdf'],
    ['http://localhost:3000/a'],
    [
      `https://exemplo.com/${'a'.repeat(CATALOG_LIMITS.urlMaxLength - 'https://exemplo.com/'.length)}`,
    ],
  ])('aceita %s', (url) => {
    expect(checkContentUrl(url).ok).toBe(true);
  });

  it.each([
    ['http://exemplo.com/video.mp4', 'scheme'],
    ['ftp://exemplo.com/a', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['https://user:pass@exemplo.com/a', 'credentials'],
    ['https://user@exemplo.com/a', 'credentials'],
    ['https://@exemplo.com/a', 'credentials'],
    ['https://exemplo.com/a b', 'whitespace'],
    [' https://exemplo.com/a', 'whitespace'],
    ['', 'empty'],
    ['https://', 'malformed'],
    ['nada', 'malformed'],
    [`https://exemplo.com/${'a'.repeat(CATALOG_LIMITS.urlMaxLength)}`, 'too_long'],
    ['http://exemplo.localhost.com/a', 'scheme'],
  ])('recusa %s (%s)', (url, problem) => {
    expect(checkContentUrl(url)).toEqual({ ok: false, problem });
  });

  it('recusa o que não é texto', () => {
    expect(checkContentUrl(42)).toEqual({ ok: false, problem: 'not_text' });
  });

  it('URL fora das regras é 422 content_url_invalid com o campo e o motivo', () => {
    let caught: unknown;
    try {
      assertContentUrl('http://exemplo.com/a', 'body.videoUrl');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    const error = caught as DomainError;
    expect(error.status).toBe(422);
    expect(error.code).toBe('content_url_invalid');
    expect(error.errors).toEqual([{ path: 'body.videoUrl', message: expect.any(String) }]);
  });
});

describe('classificação do provedor', () => {
  const cases: Array<[string, VideoProvider]> = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'youtube'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/live/abcdef', 'youtube'],
    ['https://vimeo.com/123456789', 'vimeo'],
    ['https://player.vimeo.com/video/123456789', 'vimeo'],
    ['https://iframe.mediadelivery.net/embed/1234/abcd-ef', 'bunny'],
    ['https://vz-abc.b-cdn.net/abcd/playlist.m3u8', 'bunny'],
    ['https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=abc', 'panda'],
    ['https://cdn.exemplo.com/aulas/aula1.mp4', 'file'],
    ['https://cdn.exemplo.com/aulas/aula1.WEBM?token=1', 'file'],
    // P5: `.m3u8` de host fora da tabela vira `link`.
    ['https://cdn.exemplo.com/live/playlist.m3u8', 'link'],
    ['https://b-cdn.net.exemplo.com/playlist.m3u8', 'link'],
    // Só `.mp4` e `.webm` são `file`.
    ['https://cdn.exemplo.com/aula.mov', 'link'],
    ['https://cdn.exemplo.com/aula.mkv', 'link'],
    // Padrões incompletos da tabela.
    ['https://www.youtube.com/watch', 'link'],
    ['https://www.youtube.com/shorts/abc', 'link'],
    ['https://youtu.be/', 'link'],
    ['https://vimeo.com/canal/abc', 'link'],
    ['https://player.vimeo.com/video/abc', 'link'],
    ['https://iframe.mediadelivery.net/play/1', 'link'],
    ['https://vz-abc.b-cdn.net/abcd/video.ts', 'link'],
    ['https://tv.pandavideo.com.br/embed/?v=abc', 'link'],
    ['https://player-vz-abc.tv.pandavideo.com.br/outra', 'link'],
    ['https://exemplo.com/pagina', 'link'],
  ];

  it.each(cases)('%s é %s', (url, provider) => {
    expect(classifyVideoProvider(url)).toBe(provider);
  });

  it('parseVideoUrl valida e classifica', () => {
    expect(parseVideoUrl('https://youtu.be/abc', 'body.videoUrl')).toEqual({
      videoUrl: 'https://youtu.be/abc',
      videoProvider: 'youtube',
    });
    expect(() => parseVideoUrl('http://youtu.be/abc', 'body.videoUrl')).toThrow(DomainError);
  });
});

describe('capa de produto (spec 029)', () => {
  it('o admin aceita product_cover de instrutor, gerente e admin', () => {
    for (const role of ['instructor', 'manager', 'admin']) {
      expect(canUploadImagePurpose('admin', role, 'product_cover')).toBe(true);
    }
    expect(canUploadImagePurpose('admin', 'student', 'product_cover')).toBe(false);
    expect(canUploadImagePurpose('classroom', 'admin', 'product_cover')).toBe(false);
    expect(IMAGE_VARIANT_SPECS.product_cover).toEqual({ widths: [480, 1280], aspect: 16 / 9 });
  });
});
