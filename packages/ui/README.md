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
  Para aplicar o tema salvo antes da primeira pintura, use no `vite.config.ts` do site o plugin
  `themeBootPlugin()` de `@nuva-edu/ui/theme-boot` (entrada sem CSS nem JSX, que o arquivo de
  configuração consegue importar; também exporta `THEME_BOOT_SCRIPT` e `THEME_STORAGE_KEY`).
- Os textos padrão dos componentes são exemplos; os sites passam os das suas traduções pelas props.

## Link do roteador

O pacote não conhece roteador. O site entrega o seu componente de link uma vez, e `AdminButton`,
`AdminNav`, `AdminSidebar`, `AdminBreadcrumb`, `TextLink`, `ShellFooter` e `ClassroomShell` passam a
usá-lo nos endereços internos (`/caminho`); link externo, `target="_blank"` e `download` seguem `<a>`.

```tsx
import { type LinkComponent, LinkProvider } from '@nuva-edu/ui';
import { Link } from 'react-router';

const RouterLink: LinkComponent = ({ href, ...rest }) => <Link to={href} {...rest} />;
<LinkProvider component={RouterLink}>{app}</LinkProvider>;
```

Cada componente também aceita `linkComponent`, que vale mais que o do provedor.

## Cascas

- `AdminShell`: `fullPage` tira a moldura e ocupa a tela; `drawerBelow={1024}` transforma o menu em
  gaveta abaixo dessa largura de tela (a `AdminTopbar` ganha o botão que a abre; textos em
  `drawerLabels`). Sem essas props, a janela é a de sempre.
- `ClassroomShell`: casca do site do aluno (barra superior, menu em coluna ou gaveta, trilha,
  conteúdo e rodapé). Textos em `labels`, página atual em `active`, foco e anúncio da troca de
  página por `mainRef` e `announcement`.
- `ShellFooter`: rodapé das duas cascas (texto e links, o externo em outra aba).

## Fluxo e estados (TypeScript)

`PageTitle`, `TextLink`, `LoadingState` (`role="status"`) e `ErrorState` (`role="alert"`, com
`onRetry` e `retryLabel`). Usam os tokens `--adm-*`: ficam dentro de `AdminScope` ou de uma casca.

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
  As cascas abrem em página inteira em `?demo=classroom` e `?demo=admin`.
- `pnpm --filter @nuva-edu/ui test`: testes de renderização (Vitest + Testing Library).
- `pnpm --filter @nuva-edu/ui typecheck`: checagem de tipos.
