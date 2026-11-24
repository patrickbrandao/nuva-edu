# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões: [SemVer](https://semver.org/lang/pt-BR/).
Detalhe das decisões em `specs/decisions/`.

## [Não lançado]

### Adicionado
- `task:abort` recusa sem `--force` quando o branch tem commits fora da `main`.
- `verify:quick`: YAML (`.yml` e `.yaml`) entra no passo `lint`; o `pnpm-lock.yaml` continua fora (task 062).
- Worker: sinal de aborto por tarefa (encerramento e trava perdida) e medidores `jobs_oldest_pending_seconds` e `db_pool_connections{state}`; classroom-api confere cada evento SSE com o `StreamEvent` do contrato antes de entregar, expõe `db_pool_connections{state}` e usa o SSE, o estado por requisição, as métricas e a saúde do api-kit.
- admin-api expõe `db_pool_connections{state}` (`active`, `idle`, `waiting`); o teste do IP real do api-kit usa a lista padrão de proxies do núcleo (CGNAT, link-local e `::1`).
- Specs alinhadas ao código da tarefa 050 (tarefa 066): sinal de interrupção do worker e `jobs_total{outcome="released"}`, estados de `db_pool_connections`, medidores da fila sem série com o banco fora, descarte de evento SSE por `contract_mismatch`, respostas `408` e `431` no formato do servidor HTTP, variante 512 na rota de imagens e `logoUrl` em 256.
- Specs 000 a 033, plano em 8 fases, ADRs 0001 a 0018.
- Definições de papel para Claude Code e OpenCode.
- Compose base: Postgres 18, Traefik opcional, Mailpit.
- Contratos OpenAPI 3.1 iniciais das duas APIs: componentes comuns, saúde, `/api/v1/meta` e SSE.
- Monorepo pnpm 12, TypeScript 7, Biome, lefthook (lint no pre-commit, commit validado).
- `pnpm db:migrate` (`up`, `down`, `status`, `template`), migration 0001 (`settings`) e banco modelo dos testes.
- `packages/ui` (`@nuva-edu/ui`): tokens, Inter, primitivos, painel admin, preços e tema Sistema/Claro/Escuro do minui; catálogo e testes de renderização.
- `packages/api-client` (`@nuva-edu/api-client`): clientes tipados da admin-api e da classroom-api gerados dos contratos, erro problem+json (`ApiError`), fluxo SSE tipado e verificação de gerado desatualizado.
- `packages/core` (`@nuva-edu/core`): configuração validada por variável de ambiente, conexão Kysely com tipos gerados do banco, logger JSON com máscara de campos proibidos e erro de domínio em problem+json.
- Migration 0002: tabela `jobs` da fila (spec 005) com índice parcial de consumo para `SKIP LOCKED`, `unique_key` única entre tarefas ativas e gatilho de `NOTIFY nuva_jobs`.
- Migration 0003: índice parcial `jobs_unique_key_idx` (existência da recorrente em qualquer estado) e sequência `user_event_id_seq` (`bigint`) para o `id` dos eventos do SSE.
- `@nuva-edu/core`: fila de tarefas sobre `jobs` (`enqueue`, `enqueueRecurring`, claim com `SKIP LOCKED`, batimento, nova tentativa com espera crescente, tarefa presa, reenfileirar, contagens), registro tipado de tipos e escuta do `NOTIFY nuva_jobs` com reconexão.
- `pnpm verify:quick` e `pnpm verify:full` (`scripts/verify.mjs`): lint, tipos e testes só do que mudou no rápido; suíte inteira com Postgres isolado por Testcontainers no completo; `scripts/test-db.mjs` como setup global do banco dos testes (`NUVA_TEST_DB=local`).
- `apps/admin` (`@nuva-edu/admin`): esqueleto do site admin com casca `AdminShell`, menu lateral da spec 006, tema Sistema/Claro/Escuro, traduções pt-BR (i18next), painel com os dados de `/api/v1/meta`, estrutura da tela de login e rodapé com o link "Código-fonte".
- `apps/classroom` (`@nuva-edu/classroom`): esqueleto do site do aluno com casca responsiva (menu da spec 006, gaveta abaixo de 1024 px), tema, traduções pt-BR, vitrine vazia com os dados de `/api/v1/meta`, login só com a estrutura e link "Código-fonte" no rodapé.
- `packages/api-kit` (`@nuva-edu/api-kit`): base HTTP das APIs sobre Fastify, com requisição e resposta validadas pelo `openapi.yaml`, conferência rotas x contrato (e `csrfToken` nas escritas), problem+json, `X-Request-Id`, IP real por `TRUSTED_PROXIES`, `/healthz`, `/readyz`, `/metrics` e encerramento limpo.
- `apps/admin-api` (`@nuva-edu/admin-api`): esqueleto do serviço sobre o api-kit, com `GET /api/v1/meta`, testes de integração e teste de contrato.
- `apps/worker` (`@nuva-edu/worker`): laço de consumo da fila (`NOTIFY` + varredura, concorrência, batimento, tarefa presa, encerramento em `SIGTERM`), agendador das recorrentes no fuso da escola, tarefas `example.echo` e `retention.purge` (ainda vazia) e HTTP interno com `/healthz`, `/readyz` e `/metrics`.
- `apps/classroom-api` (`@nuva-edu/classroom-api`): esqueleto do serviço sobre o api-kit, com `GET /api/v1/meta` e o fluxo SSE `GET /api/v1/stream` (uma escuta `LISTEN nuva_user_events` por processo, entrega por usuário, `ping` a cada 25 s, limite de 3 conexões, reenvio por `Last-Event-ID`, métrica `sse_connections`); sessão recusada com `401` até a Fase 1; testes de integração e de contrato.
- `@nuva-edu/core`: configuração da escola (`school.name`, `school.timezone`) com leitor em cache, `publishUserEvent` e `listenChannel` para o SSE, `databasePoolStats`, `getOldestPendingJobAgeSeconds` e contexto com `AbortSignal` nos manipuladores de tarefa; a máscara do logger deixa passar `unique_key`, `setting_key` e chaves de tradução.
- `@nuva-edu/ui`: componente de link do roteador (`LinkProvider`, `linkComponent`) em `AdminButton`, `AdminNav`, `AdminSidebar` e `AdminBreadcrumb`; `AdminShell` em página inteira (`fullPage`) e com menu em gaveta (`drawerBelow`), sem piscar ao nascer recolhido; casca do aluno `ClassroomShell` e rodapé `ShellFooter`; `PageTitle`, `TextLink`, `LoadingState` e `ErrorState`; entrada `@nuva-edu/ui/theme-boot` (script e plugin Vite do tema, sem CSS nem JSX); `navLabel` no `AdminSidebar`, `wrap` no `AdminDetails` e `AdminEmpty` sem `<strong>` vazio.
- Docker das aplicações: `Dockerfile` em estágios e `docker-compose.yml` das cinco aplicações (raiz somente leitura, limites, sem capacidades, healthcheck), serviço `migrate` antes das APIs, rotas do Traefik por host (`/api/`, `/mcp`, `/healthz` para as APIs; o resto para os sites em Nginx, com `/config.json` gerado na subida), `pnpm compose`, `pnpm dev:up` e `pnpm dev:down`; healthcheck do Traefik corrigido.
- `e2e` (`@nuva-edu/e2e`): Playwright ligado ao `pnpm verify:full --e2e`, reutilizando ou subindo o ambiente Compose, com a fumaça dos dois sites (dados de `/api/v1/meta`, tema, 360 px, gaveta do classroom) e dos backends pelo proxy (`/healthz`, `/readyz` e `/metrics` em 404, SSE em 401, saúde do worker).
- `@nuva-edu/core`: configurações de marca (`school.logo_image_id`, `school.accent_color`, `school.source_code_url`) com aviso no log para valor inválido, `schoolLogoUrl`/`imagePath`, lista padrão de `TRUSTED_PROXIES` com CGNAT, link-local e `::1`, `NUVA_LOCALE` na forma canônica e `data` de `publishUserEvent` tipado por `kind`.
- `check-contract [--no-pending]` (`runCheckContract` do `@nuva-edu/api-kit`, script `check-contract` na `admin-api`): confere rotas e contrato sem banco e falha com operação `x-nuva-pending`; HTTP malformado responde `400 validation_failed` em problem+json.
- `scripts/task.mjs`: `pnpm task:start`, `task:finish`, `task:abort`, `task:path` e `task:list` (um worktree por tarefa em `.worktrees/task-NNN`, branch `task/NNN`); `CHANGELOG.md` com `merge=union`; base do `verify:quick` passa a ser a `main` local.
- classroom-api: comando `check-contract [--no-pending]` (script `check-contract`), sem banco e sem porta; `buildClassroomApp` aceita `listenUserEvents: false`.

### Alterado
- Infra: `postgres`, `traefik` e `mailpit` sem capacidades (`cap_drop: ALL`, `no-new-privileges`), Postgres sem root, `nofile` 65536 no banco e no proxy, `healthcheck` no Mailpit; sites com `Content-Security-Policy` sem `unsafe-inline` (hash do script do tema gerado no build da imagem); pre-commit confere YAML; `verify:quick` sobe o banco por `pnpm compose`.
- `@nuva-edu/admin`: contornos trocados pelos componentes de `@nuva-edu/ui` (link do roteador, casca em página inteira, rodapé, estados de carregando e erro, script de tema pelo plugin); abaixo de 1024 px o menu lateral é uma gaveta.
- Contratos base: `Page` só com `nextCursor` (cada listagem declara `items`), CSRF como esquema de segurança `csrfToken` em vez de parâmetro, e códigos de erro gerais fixados na spec 003 e no esquema `Problem` (com `retryAfterSeconds`).
- `@nuva-edu/api-client`: gerado em dia com os contratos da tarefa 019; `ApiError.retryAfter` usa `retryAfterSeconds` quando falta o `Retry-After`; script `test:files` para o `verify:quick` filtrar os testes.
- `verify`: passo `tipos-banco` (`db:types:check` do core) no completo e, no rápido, quando uma migration muda; contrato alterado também confere o cliente gerado (passo `cliente`); no completo os testes de contrato rodam uma vez só.
- `@nuva-edu/api-kit`: requisição abortada pelo cliente registrada no log e nas métricas HTTP com status 499; base de SSE (`eventStreams`, cabeçalhos, `sse_connections`, fechamento no `preClose`); `413 payload_too_large` e `415 unsupported_media_type` no lugar de `400`; operação `x-nuva-pending` aceita sem rota; validação de esquema avulso; dados tipados por requisição; entradas `/metrics` e `/health` sem Fastify.
- Infra: `/config.json` dos sites só com `app`, `adminUrl` e `classroomUrl`; os contêineres `admin` e `classroom` deixam de receber `NUVA_CURRENCY` e `NUVA_LOCALE`; corrigida a validação que recusava `NUVA_PUBLIC_PORT` vazia; exige reconstruir as imagens dos sites (tarefa 060).
- Specs pós-Docker e pós-api-kit (tarefas 051 e 052): `migrate` no compose da admin-api, `proxy/nginx/` e `.dockerignore`, `/config.json` dos sites só com `app`, `adminUrl` e `classroomUrl` (moeda, idioma e versão vêm do `/meta`), `NUVA_VERSION` nas imagens, SSE atrás do proxy sem o limite de 1 hora, `env_file` nos serviços de backend (sem `PORT` nos arquivos), segredos exigidos por fase, Postgres sem porta fora do desenvolvimento, status 499 e base de SSE do kit, passos `cliente` e `tipos-banco` do `verify` e YAML no lint.
- Specs pós-esqueletos (ADRs 0019 e 0020): janela de contrato e `x-nuva-pending`, erros `payload_too_large` (413) e `unsupported_media_type` (415), marca da escola no `/meta`, chaves `school.*` de `settings`, `PORT`, lista padrão de `TRUSTED_PROXIES` com CGNAT e link-local, carga e reenvio dos eventos do SSE, regras das recorrentes e da tabela `jobs`, métricas do worker, um arquivo de tradução por idioma; `Locale` dos contratos aceita o mesmo formato de `NUVA_LOCALE`.
- Classroom: casca, rodapé, títulos e estados passam a usar `ClassroomShell`, `ShellFooter`, `PageTitle`, `LoadingState` e `ErrorState` de `@nuva-edu/ui`; links internos pelo `LinkProvider` (task 041).

### Decisões
- Textos de processo alinhados ao `scripts/task.mjs` (`--as`, `task:list`, push negado, conflito de rebase).
- Instalável, uma escola por instalação; AGPL-3.0.
- `admin-api` (com MCP) e `classroom-api` sobre um Postgres; worker com fila no banco; SSE.
- Senha em texto legível, exibida só ao admin.
- Venda avulsa e assinatura via Mercado Pago; conteúdo por link externo.
- TypeScript, Node 26, Fastify contrato primeiro, Kysely, React 19, minui em `packages/ui`.
- Commit direto na `main`, diretório compartilhado; `verify:quick` e `verify:full`.
- Um worktree por tarefa (`pnpm task:start`/`task:finish`, branch `task/NNN`, `main` só por fast-forward) no lugar do commit direto em diretório compartilhado: ADR 0021 substitui a 0013; specs 002 e 032, `AGENTS.md` e definições de papel atualizados.
