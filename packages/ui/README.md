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

## Cor de destaque da escola

A escola escolhe uma cor `#RRGGBB` (spec 006, RF-06) e o site a grava em `--minui-accent` no
`<html>`, pelo CSSOM (`style.setProperty`; a CSP `style-src 'self'` não barra). É só isso: o
resto é CSS do pacote (`src/styles/tokens.css`), sem JavaScript e sem `style` no HTML. Sem a
variável, tudo fica no padrão neutro (botão cheio quase preto no claro e quase branco no escuro).

Os componentes não usam `--minui-accent` direto, e sim os tokens derivados dela:

| Token | Onde entra | Regra |
| --- | --- | --- |
| `--minui-accent-fill` | fundo do botão primário, da caixa marcada e da chave ligada | a própria cor |
| `--minui-accent-on` | texto e ícone sobre o fundo cheio | branco se a luminância relativa da cor (WCAG) for menor que 0,179; senão preto. Nunca menos de 4,58:1 |
| `--minui-accent-hover` | fundo cheio sob o ponteiro | 14% de branco ou preto, para o lado que mantém o texto acima de 4,5:1 |
| `--minui-accent-edge` | contorno do fundo cheio | 22% da cor do texto; aparece quando a cor é quase a da página |
| `--minui-accent-text` | link de texto, anel de foco, ícone do item atual do menu | a cor escurecida até a luminância 0,115 no tema claro e clareada até 0,32 no escuro: 4,5:1 ou mais sobre qualquer superfície `--adm-*` |
| `--minui-accent-tint` | fundo do item atual do menu | 12% de `--minui-accent-text`; o texto do item segue `--adm-ink` |

A cor nunca é usada crua como texto, e o texto sobre ela é sempre calculado: por isso qualquer
`#RRGGBB` mantém o contraste AA. As contas usam cor relativa em `srgb-linear` (Chrome 119,
Firefox 128, Safari 16.4 em diante); navegador mais antigo ignora o bloco e fica com o padrão
neutro. `--minui-accent` também pode ser definida num elemento qualquer que contenha um
`AdminScope` ou uma casca (é assim que o catálogo mostra três cores na mesma página).

O anel de foco é o mesmo em todo controle que os sites usam: `--adm-focus` dentro de um
`AdminScope` ou de uma casca, e `var(--minui-accent-text, var(--minui-blue))` no `ThemeSwitch`
(que também vive fora delas; sem a cor da escola, o azul de sempre).

As iniciais do `AdminAvatar` saem em branco ou preto, o que der 4,5:1 sobre o fundo (a regra de
`accentOn`, aplicada à cor derivada do nome ou a `color` em `#RRGGBB`). Com a propriedade
`accent`, usada pela marca do `ClassroomShell` quando a escola não tem logotipo, o quadrado é
`--minui-accent-fill` com o texto `--minui-accent-on`; sem cor de destaque, vale a cor do nome.

As mesmas contas existem em TypeScript, para teste e para o site que precisar do resultado fora
do CSS (ex.: prévia da cor nas configurações): `accentOn(cor)`, `accentHover(cor)`,
`accentText(cor, 'light' | 'dark')`, `contrastRatio(a, b)`, `relativeLuminance(cor)` e
`isHexColor(valor)`. `src/accent/accent.test.ts` confere o AA numa grade de 4.096 cores e que os
números do CSS e do TypeScript são os mesmos.

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
- Gaveta aberta (nas duas cascas): é um `role="dialog"` modal; o foco entra no botão de fechar,
  Tab e Shift+Tab dão a volta dentro dela, Esc fecha e o foco volta ao botão que a abriu. O resto
  da página fica `inert`, inclusive o link "Ir para o conteúdo" da `ClassroomShell`. O site não
  precisa de armadilha de foco própria.
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
  As cascas abrem em página inteira em `?demo=classroom` e `?demo=admin`; com
  `&accent=%23RRGGBB` a cor de destaque é aplicada em `<html>`, como nos sites.
- `pnpm --filter @nuva-edu/ui test`: testes de renderização (Vitest + Testing Library).
- `pnpm --filter @nuva-edu/ui typecheck`: checagem de tipos.
