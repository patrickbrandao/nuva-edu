# @nuva-edu/ui

Componentes e tokens de interface do nuva-edu, copiados e adaptados do projeto
minui-react (ADR 0010, spec 006). O pacote não depende do minui-react em tempo de build.

## Uso

```tsx
import { AdminButton, ThemeSwitch, useTheme } from '@nuva-edu/ui';
```

- O app consome o código-fonte (`exports` aponta para `src/index.ts`); o Vite do app compila JSX, TSX e CSS.
- Cada componente importa o próprio CSS e os tokens (`src/styles/tokens.css`, também em `@nuva-edu/ui/tokens.css`).
- Tema: `useTheme()` devolve `[modo, trocar, temaEmUso]` e grava em `localStorage` na chave `nuva-theme`.
  Ponha `THEME_BOOT_SCRIPT` num `<script>` do `<head>` para aplicar o tema salvo antes da primeira pintura.
- Os textos padrão dos componentes são exemplos; os sites passam os das suas traduções pelas props.

## O que veio do minui-react

| Origem (`src/`) | Aqui |
| --- | --- |
| `styles/tokens.css`, `assets/fonts` | `src/styles`, `src/assets/fonts` |
| `components/core` (sem `AppIcon` e `CardHeader`) | `src/components/core` |
| `components/admin` | `src/components/admin` |
| `components/examples` (`ExamplePage`, `PricingPage`, `MarketingWaitlist`) | `src/components/examples` |
| `components/snippets` | `src/components/snippets` |
| `lib/util.js`, `lib/measure.js` | `src/lib` |
| `showcase/theme.jsx` | `src/theme/theme.tsx` (TypeScript, chave `nuva-theme`) |

Diferenças: o `Avatar` não usa a folha de retratos de demonstração (só `src` ou iniciais), e a
propriedade `portrait` do `AdminAvatar` deu lugar a `src`.

Os componentes copiados seguem em JSX. `src/index.ts` os expõe ao TypeScript com todas as
propriedades opcionais e sem tipo de valor (`Loose`); cada um ganha tipos próprios ao ser convertido.

## Comandos

- `pnpm --filter @nuva-edu/ui dev`: catálogo em http://127.0.0.1:5310, com os componentes nos temas claro e escuro.
- `pnpm --filter @nuva-edu/ui test`: testes de renderização (Vitest + Testing Library).
- `pnpm --filter @nuva-edu/ui typecheck`: checagem de tipos.
