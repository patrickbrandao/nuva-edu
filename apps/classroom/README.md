# @nuva-edu/classroom

Site do aluno (spec 006): SPA em React 19, Vite 8, Tailwind 4, React Router e TanStack Query.
Usa os componentes de `@nuva-edu/ui` e o cliente de `@nuva-edu/api-client/classroom`.

## Comandos

- `pnpm --filter @nuva-edu/classroom dev`: http://127.0.0.1:5312. O Vite encaminha `/api` e
  `/healthz` para a classroom-api em `NUVA_CLASSROOM_API_URL` (padrão `http://127.0.0.1:3000`).
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
| `src/locales/pt-BR.json` | Todos os textos visíveis; as chaves são conferidas pelo compilador |
| `src/lib/` | `usePageMeta` (título, descrição e Open Graph por página) |

Tela nova: troque a entrada de `PENDING_PAGES` em `src/shell/navigation.ts` por uma rota própria em
`src/routes.tsx`, com `handle.titleKey` para a trilha e `usePageMeta` na página.
