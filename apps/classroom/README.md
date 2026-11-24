# @nuva-edu/classroom

Site do aluno (spec 006): SPA em React 19, Vite 8, Tailwind 4, React Router e TanStack Query.
Usa os componentes de `@nuva-edu/ui` e o cliente de `@nuva-edu/api-client/classroom`.

## Comandos

- `pnpm --filter @nuva-edu/classroom dev`: http://127.0.0.1:5312. O Vite encaminha `/api` e
  `/healthz` para a classroom-api em `NUVA_CLASSROOM_API_URL` (padrão `http://127.0.0.1:3000`).
  O Vite também responde `/config.json` (plugin em `src/config/dev-server.ts`), com `adminUrl` e
  `classroomUrl` montados de `NUVA_PUBLIC_SCHEME`, `NUVA_ADMIN_HOST`, `NUVA_CLASSROOM_HOST`,
  `NUVA_PUBLIC_PORT` e `NUVA_DOMAIN` do ambiente do processo, com os padrões da spec 031
  (`http://edu-admin.localhost:8080` e `http://classroom.localhost:8080`). O plugin só existe no
  servidor do Vite (`dev` e `preview`): não grava arquivo no `dist/`, então nada dele vai para a
  imagem, onde o Nginx gera o arquivo na subida do contêiner.
- `pnpm --filter @nuva-edu/classroom build`: arquivos estáticos em `dist/`.
- `pnpm --filter @nuva-edu/classroom test`: Vitest + Testing Library (jsdom), com `/api/v1/meta` simulado.
- `pnpm --filter @nuva-edu/classroom typecheck`: checagem de tipos.

## Organização

| Pasta | Conteúdo |
| --- | --- |
| `src/routes.tsx` | Rotas em português; a vitrine no pacote inicial, o resto sob demanda |
| `src/shell/` | Entrega ao `ClassroomShell` de `@nuva-edu/ui` os textos, o menu (`navigation.ts`), a página atual e o rodapé |
| `src/pages/` | Vitrine, login (só a estrutura), "em construção", "não encontrado", erro |
| `src/api/` | Cliente da API da própria origem, cache e `useMeta` |
| `src/config/` | `/config.json`: `loadRuntimeConfig` (busca e valida; `null` em qualquer falha), `useRuntimeConfig` e o plugin do Vite |
| `src/session/` | Papel do usuário da sessão (`useSessionRole`); `null` até a sessão existir (Fase 1) |
| `src/locales/pt-BR.json` | Todos os textos visíveis; as chaves são conferidas pelo compilador |
| `src/lib/` | `usePageMeta` (título, descrição e Open Graph por página) |

Tela nova: troque a entrada de `PENDING_PAGES` em `src/shell/navigation.ts` por uma rota própria em
`src/routes.tsx`, com `handle.titleKey` para a trilha e `usePageMeta` na página.
