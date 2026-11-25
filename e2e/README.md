# e2e

Testes de ponta a ponta (Playwright) contra o ambiente Compose completo. Spec:
`specs/032-verificacao-e-ci.md`.

```bash
pnpm --filter @nuva-edu/e2e run browsers   # uma vez: baixa o Chromium
pnpm verify:full --e2e                     # nível completo, com o e2e no fim
pnpm --filter @nuva-edu/e2e test           # só o e2e
```

Antes dos testes, a configuração sonda os dois sites e o `/healthz` das duas APIs. Se tudo
responde, reutiliza o ambiente; se não, roda `pnpm dev:up` e sonda de novo. Nunca derruba o
ambiente. Quando algo continua fora do ar, o erro traz a URL que não respondeu e o comando.

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `NUVA_E2E_ADMIN_URL` | `http://edu-admin.localhost:8080` | Endereço do site admin (e da admin-api) |
| `NUVA_E2E_CLASSROOM_URL` | `http://classroom.localhost:8080` | Endereço do site do aluno (e da classroom-api) |
| `NUVA_E2E_COMPOSE` | (ligado) | `0`: não sobe o ambiente nem usa `docker compose exec` |

- Seletores por papel e nome acessível (`getByRole`, `getByLabel`), nunca por classe CSS.
- O `/healthz` do worker não passa pelo proxy: o teste o consulta com `pnpm compose exec worker`
  e é pulado com `NUVA_E2E_COMPOSE=0`.
- O painel exige sessão: o projeto `setup` (`tests/admin.setup.ts`) entra com o admin inicial,
  lendo `ADMIN_EMAIL` e `ADMIN_PASSWORD` do ambiente ou do `.env.local` da raiz, e guarda a
  sessão em `tmp/playwright/auth/`. Os valores nunca vão para log nem relatório.
- Relatório e rastros em `tmp/playwright/` (fora do Git).
