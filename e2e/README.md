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
| `NUVA_E2E_MAILPIT_URL` | `http://127.0.0.1:8025` | API HTTP do Mailpit, de onde os testes leem os e-mails |

- Seletores por papel e nome acessível (`getByRole`, `getByLabel`), nunca por classe CSS.
- O `/healthz` do worker não passa pelo proxy: o teste o consulta com `pnpm compose exec worker`
  e é pulado com `NUVA_E2E_COMPOSE=0`.
- O painel exige sessão: o projeto `setup` (`tests/admin.setup.ts`) entra com o admin inicial,
  lendo `ADMIN_EMAIL` e `ADMIN_PASSWORD` do ambiente ou do `.env.local` da raiz, e guarda a
  sessão em `tmp/playwright/auth/`. Os valores nunca vão para log nem relatório.
- Fluxos do critério de saída da Fase 1 em `tests/fase1/` (projetos `fase1` e `fase1-termos`; este
  publica versão nova dos termos e roda por último). Cada execução usa e-mails novos: o banco não
  é zerado.
- Atrás do Traefik local todo pedido do navegador chega com o mesmo IP. Por isso:
  - as operações de autenticação feitas pela tela esperam a vez em `support/pacing.ts` (abaixo
    de 10 por minuto no classroom e 20 no admin, os limites por IP das APIs);
  - o preparo de contas e as tentativas que precisam falhar (senha errada, senha antiga) vão
    direto à API pela rede interna, de dentro do contêiner do worker, com um IP de documentação
    sorteado (`support/isolated.ts`). Sem isso, 5 falhas bloqueariam por 15 minutos o IP de
    todos os testes. Esses testes exigem o Compose local.
- A varredura (`tests/fase1/varredura.spec.ts`) lê `pnpm compose logs` desde o início do teste.
- Relatório e rastros em `tmp/playwright/` (fora do Git).
