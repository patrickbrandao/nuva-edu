# @nuva-edu/admin

Site de administração do nuva-edu: SPA em React 19, Vite 8, Tailwind 4, React Router (modo
biblioteca, `createBrowserRouter`) e TanStack Query (spec 006).

## Comandos

- `pnpm --filter @nuva-edu/admin dev`: http://127.0.0.1:5311. O Vite repassa `/api` e `/healthz`
  à admin-api em `NUVA_ADMIN_API_URL` (padrão `http://127.0.0.1:3000`), como o proxy faz em
  produção (spec 031).
- `pnpm --filter @nuva-edu/admin build`: gera `dist/`.
- `pnpm --filter @nuva-edu/admin test`: Vitest + Testing Library + jsdom, com a API simulada.
- `pnpm --filter @nuva-edu/admin typecheck`: checagem de tipos.

## Organização

| Pasta | Conteúdo |
| --- | --- |
| `src/locales/pt-BR.json` | Todos os textos visíveis. Nada de texto fixo em componente. |
| `src/i18n/` | `i18next` + `react-i18next`, inicialização síncrona; as chaves são conferidas pelo TypeScript. |
| `src/api/` | Cliente de `@nuva-edu/api-client/admin` por contexto (`useApi`), consultas (`useMeta`). |
| `src/shell/` | Casca (`AdminShell` de `@nuva-edu/ui`), menu lateral (`menu.ts`), rodapé. |
| `src/pages/` | Telas. Item do menu ainda sem tela usa `UnderConstructionPage`. |
| `src/routes.tsx` | Rotas; uma por item de `menu.ts`. |
| `src/test/render.tsx` | `renderApp(caminho, resposta)` para os testes. |

## Convenções

- Componentes visuais vêm de `@nuva-edu/ui`, sempre com os rótulos passados por props a partir das
  traduções. O Tailwind entra sem o preflight e só no que é específico do site (`src/styles.css`).
- Tela nova: acrescente o item em `src/shell/menu.ts`, os textos em `pt-BR.json` e troque a rota
  de `UnderConstructionPage` pela tela.
- Links internos desenhados pelos componentes (`<a href="/...">`) passam pelo roteador graças a
  `useInternalLinks`, sem recarregar a página.
- O `<script>` de tema do `index.html` é o `THEME_BOOT_SCRIPT` de `@nuva-edu/ui`; um teste confere.
