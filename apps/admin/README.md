# @nuva-edu/admin

Site de administração do nuva-edu: SPA em React 19, Vite 8, Tailwind 4, React Router (modo
biblioteca, `createBrowserRouter`) e TanStack Query (spec 006).

## Comandos

- `pnpm --filter @nuva-edu/admin dev`: http://127.0.0.1:5311. O Vite repassa `/api` e `/healthz`
  à admin-api em `NUVA_ADMIN_API_URL` (padrão `http://127.0.0.1:3000`), como o proxy faz em
  produção (spec 031). Ele também responde `/config.json` (plugin `vite/devRuntimeConfig.ts`),
  montado de `NUVA_PUBLIC_SCHEME`, `NUVA_ADMIN_HOST`, `NUVA_CLASSROOM_HOST`, `NUVA_PUBLIC_PORT` e
  `NUVA_DOMAIN` com os padrões da spec 031; variável fora do formato impede a subida.
- `pnpm --filter @nuva-edu/admin build`: gera `dist/`.
- `pnpm --filter @nuva-edu/admin test`: Vitest + Testing Library + jsdom, com a API simulada.
- `pnpm --filter @nuva-edu/admin typecheck`: checagem de tipos.

## Organização

| Pasta | Conteúdo |
| --- | --- |
| `src/locales/pt-BR.json` | Todos os textos visíveis. Nada de texto fixo em componente. |
| `src/i18n/` | `i18next` + `react-i18next`, inicialização síncrona; as chaves são conferidas pelo TypeScript. |
| `src/api/` | Cliente de `@nuva-edu/api-client/admin` por contexto (`useApi`), consultas (`useMeta`). |
| `src/runtime/` | Leitura do `/config.json` (`loadRuntimeConfig`, `useRuntimeConfig`): só `app`, `adminUrl` e `classroomUrl`. |
| `vite/` | Plugin do Vite que responde `/config.json` no `dev` e no `preview`. |
| `src/shell/` | Casca (`AdminShell` de `@nuva-edu/ui`), menu lateral (`menu.ts`), rodapé. |
| `src/pages/` | Telas. Item do menu ainda sem tela usa `UnderConstructionPage`. |
| `src/routes.tsx` | Rotas; uma por item de `menu.ts`. |
| `src/test/render.tsx` | `renderApp(caminho, resposta, { config, routes })` para os testes. |

## Convenções

- Componentes visuais vêm de `@nuva-edu/ui`, sempre com os rótulos passados por props a partir das
  traduções. O Tailwind entra sem o preflight e só no que é específico do site (`src/styles.css`).
- Tela nova: acrescente o item em `src/shell/menu.ts`, os textos em `pt-BR.json` e troque a rota
  de `UnderConstructionPage` pela tela.
- Links internos dos componentes (`href="/..."`) passam pelo roteador graças ao `LinkProvider` de
  `AppProviders.tsx`, sem recarregar a página.
- `/config.json` (specs 006 e 031) é gerado na subida do contêiner e servido pelo Nginx; é a única
  chamada fora do cliente gerado. O site o busca ao abrir, sem cache, junto com o `/api/v1/meta`.
  Arquivo ausente, ilegível ou com campo fora do formato nunca vira tela de erro: o campo fica
  ausente, o link que dependia dele some e sai um aviso no console (só nome do campo e status).
  No desenvolvimento o arquivo vem de um middleware do Vite, que não grava nada: ele não entra no
  `dist/` nem na imagem.
- `NoAccessPage` ("sem acesso ao painel") ainda não tem rota: quem a mostra é a guarda de sessão
  (`403` por papel), que chega com a spec 007.
- Abaixo de 1024 px o menu lateral é uma gaveta (`drawerBelow` do `AdminShell`; spec 006, RNF-01).
- O script de tema do `<head>` vem do `themeBootPlugin()` de `@nuva-edu/ui/theme-boot`, no
  `vite.config.ts`.
