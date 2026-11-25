import { describe, expect, it } from 'vitest';

/*
 * Componentes em TypeScript do catálogo, dos avisos e do formulário não trazem texto de interface fixo:
 * nem texto entre tags no JSX, nem rótulo literal em atributo que a pessoa lê ou ouve.
 * (Mensagem de erro de programação, como a de useToast fora do provedor, não conta.)
 */
const sources = import.meta.glob<string>(
  [
    './catalog/*.tsx',
    './feedback/*.tsx',
    './form/*.tsx',
    './learning/**/*.tsx',
    '!./**/*.test.tsx',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('sem texto fixo', () => {
  it('confere os componentes em TypeScript', () => {
    const files = Object.keys(sources).sort();
    expect(files).toEqual([
      './catalog/Accordion.tsx',
      './catalog/Markdown.tsx',
      './catalog/ProductCard.tsx',
      './catalog/ProgressBar.tsx',
      './catalog/SortableList.tsx',
      './catalog/Tabs.tsx',
      './feedback/Alert.tsx',
      './feedback/Dialog.tsx',
      './feedback/Toast.tsx',
      './form/AdminTextArea.tsx',
      './form/ImagePicker.tsx',
      './form/PasswordInput.tsx',
      './learning/ActivityHeatmap.tsx',
      './learning/VideoPlayer.tsx',
      './learning/video/message.tsx',
      './learning/video/native.tsx',
      './learning/video/vimeo.tsx',
      './learning/video/youtube.tsx',
    ]);
  });

  for (const [file, raw] of Object.entries(sources)) {
    it(file, () => {
      const code = withoutComments(raw);
      // texto entre tags: `>Algo<`
      const jsxText = [...code.matchAll(/>\s*([^<>{}\s][^<>{}]*?)\s*</g)]
        .map((match) => match[1] ?? '')
        .filter((text) => /\p{L}{2,}/u.test(text) && !/[=;():,]/.test(text));
      expect(jsxText).toEqual([]);
      // atributo lido por leitor de tela ou visível com valor literal
      const attrs = [...code.matchAll(/\b(aria-label|alt|title|placeholder)="([^"]*)"/g)].map(
        (match) => match[0],
      );
      expect(attrs).toEqual([]);
    });
  }
});
