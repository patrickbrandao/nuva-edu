# 031 — Infraestrutura e deploy

Status: aprovada
Depende de: 001, 003, 004, 005, 006

## Contexto

O nuva-edu é distribuído como imagens Docker e um conjunto de arquivos Compose. A mesma estrutura serve ao desenvolvimento (Docker Desktop), ao servidor de testes (que já tem um Traefik compartilhado) e à instalação de cada escola. Esta spec fixa a organização dos arquivos, os padrões de contêiner, as variáveis de ambiente e o caminho de publicação.

## Requisitos

- RF-01: Um único `docker compose up -d` na raiz sobe uma instalação completa, com proxy próprio, a partir de `.env` e `.env.local`.
- RF-02: Cada sistema tem o seu `docker-compose.yml` na própria pasta; o `docker-compose.yml` da raiz apenas os inclui (`include:`).
- RF-03: O Traefik próprio, o backup e o Mailpit são perfis opcionais.
- RF-04: Os nomes de host dos dois sites vêm de variáveis de ambiente.
- RF-05: Nenhuma senha ou chave tem valor padrão: o Compose falha com mensagem clara se faltar (`${VAR:?}`).
- RF-06: As migrations são aplicadas por um serviço de execução única antes de as APIs e o worker subirem.
- RF-07: As APIs obtêm o IP real do cliente a partir dos cabeçalhos do proxy, confiando apenas nas origens de `TRUSTED_PROXIES`.
- RF-08: As imagens são publicadas para `linux/amd64` e `linux/arm64` em `tmsoftbrasil/nuva-edu-<app>`.
- RF-09: `pnpm deploy:test` atualiza o servidor de testes a partir da máquina do desenvolvedor.
- RNF-01: Instalação nova no ar em até 15 minutos, contados do `git clone` ao login do admin, numa máquina de 2 vCPU e 4 GB.
- RNF-02: A soma dos limites de memória dos contêineres do perfil padrão não passa de 3 GB.
- RNF-03: Toda porta publicada no hospedeiro é maior que 1024.
- RNF-04: Reiniciar qualquer contêiner não perde dados: só há escrita em volumes nomeados.
- RNF-05: `docker compose up -d` numa instalação já migrada fica saudável em menos de 60 s.

## Comportamento

### Organização dos arquivos

| Caminho | Conteúdo |
| --- | --- |
| `docker-compose.yml` | Só `include:` dos arquivos abaixo |
| `.env` | Valores padrão não secretos (versionado) |
| `.env.example` | Todas as variáveis, com descrição |
| `.env.local` | Segredos e ajustes da instalação (fora do Git) |
| `database/postgres/docker-compose.yml` | `postgres`, `migrate` e, no perfil `backup`, `backup` |
| `database/postgres/migrations/` | Arquivos `.sql` numerados |
| `proxy/traefik/docker-compose.yml` | `traefik` (perfil `traefik`) |
| `mail/mailpit/docker-compose.yml` | `mailpit` (perfil `mailpit`) |
| `apps/<app>/docker-compose.yml` | Um por aplicação: `admin-api`, `classroom-api`, `worker`, `admin`, `classroom` |
| `apps/<app>/Dockerfile` | Build em stages |

O Compose lê `.env` e depois `.env.local` (`env_file` e `--env-file`, encapsulados nos scripts `pnpm compose ...`).

### Serviços

| Serviço | Imagem | Porta interna | CPU | Memória | Perfil |
| --- | --- | --- | --- | --- | --- |
| `postgres` | `postgres:18` | 5432 | 1 | 1024 MB | padrão |
| `migrate` | `nuva-edu-admin-api` (comando de migration) | — | 1 | 256 MB | padrão (execução única) |
| `admin-api` | `nuva-edu-admin-api` | 3000 | 1 | 384 MB | padrão |
| `classroom-api` | `nuva-edu-classroom-api` | 3000 | 1 | 512 MB | padrão |
| `worker` | `nuva-edu-worker` | 3000 (saúde e métricas) | 1 | 384 MB | padrão |
| `admin` | `nuva-edu-admin` | 8080 | 1 | 64 MB | padrão |
| `classroom` | `nuva-edu-classroom` | 8080 | 1 | 64 MB | padrão |
| `traefik` | `traefik:v3` | 8080 / 8443 | 1 | 128 MB | `traefik` |
| `backup` | `postgres:18` com script | — | 1 | 256 MB | `backup` |
| `mailpit` | `axllent/mailpit` | 1025 / 8025 | 1 | 64 MB | `mailpit` |

CPU e memória de cada serviço são ajustáveis por `NUVA_<SERVICO>_CPUS` e `NUVA_<SERVICO>_MEMORY`.

### Padrões de todo contêiner

- `deploy.resources.limits` com CPU e memória (tabela acima).
- `read_only: true`; `/run` e `/tmp` em `tmpfs`; escrita apenas em volumes nomeados (`postgres-data`, `backup-data`, `traefik-acme`).
- `ulimits.nofile` explícito: 65536 para `postgres`, `traefik` e as APIs; 4096 para os demais.
- Usuário sem privilégios, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`.
- `healthcheck` em todos; dependências com `condition: service_healthy` (ou `service_completed_successfully` para `migrate`).
- `restart: unless-stopped`, exceto `migrate`.
- Logs com rotação: `json-file`, `max-size: 10m`, `max-file: 5`.
- Só o `traefik` (e, em desenvolvimento, `postgres` e `mailpit`, em `127.0.0.1`) publica portas no hospedeiro.

### Dockerfiles

Build em stages, na ordem que favorece o cache:

1. `deps`: copia só `pnpm-lock.yaml`, `pnpm-workspace.yaml` e os `package.json`; instala dependências.
2. `build`: copia o código e compila a aplicação e os pacotes de que ela depende.
3. `runtime`: imagem mínima (`node:26-slim` para APIs e worker; Nginx sem privilégios para os sites), só com o resultado do build e as dependências de produção.

Os sites são estáticos: os nomes de host e a moeda chegam em tempo de execução por um `config.json` gerado na subida do contêiner, não no build, para que a mesma imagem sirva a qualquer instalação.

### Roteamento

| Host | Caminho | Serviço |
| --- | --- | --- |
| `NUVA_ADMIN_HOST` | `/api/` | `admin-api` |
| `NUVA_ADMIN_HOST` | `/mcp` | `admin-api` |
| `NUVA_ADMIN_HOST` | `/healthz` | `admin-api` |
| `NUVA_ADMIN_HOST` | demais | `admin` |
| `NUVA_CLASSROOM_HOST` | `/api/` | `classroom-api` |
| `NUVA_CLASSROOM_HOST` | `/healthz` | `classroom-api` |
| `NUVA_CLASSROOM_HOST` | demais | `classroom` |

- `/healthz` é a única sonda roteada para fora, para monitoramento externo; `/readyz` e `/metrics` ficam só na rede interna ([033](033-observabilidade-retencao-backup.md)).
- Os rótulos do Traefik ficam no `docker-compose.yml` de cada aplicação e usam `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINTS` e `TRAEFIK_CERTRESOLVER`.
- Com `TRAEFIK_CERTRESOLVER` vazio, os rótulos de TLS não são emitidos (desenvolvimento em HTTP).
- A rota de SSE (`/api/v1/stream`) desliga o buffer de resposta e tem tempo limite de leitura de 1 hora.
- `/metrics` e `/readyz` não são roteados pelo proxy.

### IP real do cliente

- As APIs leem `X-Forwarded-For` (e `X-Real-IP` como alternativa) somente quando a conexão vem de um endereço listado em `TRUSTED_PROXIES`; fora disso, vale o endereço da conexão TCP.
- Padrão de `TRUSTED_PROXIES`: faixas privadas (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `fc00::/7`). Quem instala pode restringir à rede do proxy.
- Do `X-Forwarded-For`, usa-se o endereço mais à direita que não pertence a `TRUSTED_PROXIES`.
- O IP assim obtido alimenta o limite de tentativas de login, a auditoria e os logs.

### Ambientes

| Item | `dev` (Docker Desktop) | `teste` (servidor opencode) |
| --- | --- | --- |
| Perfis | `traefik`, `mailpit` | nenhum (Traefik já existe) |
| `NUVA_DOMAIN` | `localhost` | `opencode.tmsoft.com.br` |
| Sites | `http://edu-admin.localhost:8080`, `http://classroom.localhost:8080` | `https://edu-admin.opencode.tmsoft.com.br`, `https://classroom.opencode.tmsoft.com.br` |
| `TRAEFIK_NETWORK` | `nuva-edu-proxy` (criada pelo Compose) | `network_public` (externa) |
| `TRAEFIK_ENTRYPOINTS` | `web` | `websecure` |
| `TRAEFIK_CERTRESOLVER` | vazio | `letsencrypt` |
| E-mail | Mailpit (`http://localhost:8025`) | SMTP real de teste |
| Mercado Pago | credenciais de teste | credenciais de teste |
| Imagens | build local | Docker Hub, etiqueta do commit |
| Postgres no hospedeiro | `127.0.0.1:5432` | não publicado |

No servidor de testes o Traefik existente redireciona a porta 80 para a 443 e expõe só contêineres com `traefik.enable=true`; o nuva-edu não altera a configuração dele.

"Produção" é a instalação de cada escola: mesmo Compose, perfil `traefik` (ou proxy existente), perfil `backup` recomendado; o passo a passo fica em `docs/`.

### Publicação de imagens

- Repositórios: `tmsoftbrasil/nuva-edu-admin-api`, `-classroom-api`, `-worker`, `-admin`, `-classroom`.
- Plataformas: `linux/amd64` e `linux/arm64`, num único manifesto.
- Etiquetas: `sha-<7 caracteres>` e `main` a cada push na `main`; `X.Y.Z`, `X.Y` e `latest` a cada tag `vX.Y.Z`.
- O Compose usa `NUVA_IMAGE_TAG` (padrão `latest`).

### `pnpm deploy:test`

Executa `scripts/deploy-test.sh` na máquina do desenvolvedor, usando o SSH dele; usuário, host e porta vêm de `NUVA_DEPLOY_SSH_USER`, `NUVA_DEPLOY_SSH_HOST` e `NUVA_DEPLOY_SSH_PORT`, definidos no `.env.local`:

1. Confere que o commit atual está na `origin/main` e que as imagens `sha-<commit>` existem no Docker Hub; se não, para com a instrução.
2. Envia os arquivos Compose e o `.env` para `/opt/nuva-edu` no servidor (o `.env.local` do servidor nunca é sobrescrito).
3. No servidor: `docker compose pull`, executa `migrate`, `docker compose up -d`.
4. Espera a saúde de todos os serviços (até 120 s) e chama `/healthz` dos dois sites pela URL pública.
5. Mostra a versão publicada; em falha, mostra os logs do serviço que não ficou saudável e sai com código diferente de zero. Não faz volta automática.

O script só age sobre o projeto Compose `nuva-edu`; qualquer outra ação no servidor exige o humano ([002](002-organizacao-do-trabalho.md)).

## Interfaces e contratos

### Variáveis de ambiente

"Segredo" = sem valor padrão, definida em `.env.local`.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NUVA_DOMAIN` | `localhost` | Domínio base |
| `NUVA_ADMIN_HOST` | `edu-admin.${NUVA_DOMAIN}` | Host do site admin |
| `NUVA_CLASSROOM_HOST` | `classroom.${NUVA_DOMAIN}` | Host do classroom |
| `NUVA_PUBLIC_SCHEME` | `http` | `http` ou `https`, para montar URLs em e-mails e retornos |
| `NUVA_PUBLIC_PORT` | `8080` | Porta pública; vazio quando 80/443 |
| `NUVA_CURRENCY` | `BRL` | Moeda da instalação |
| `NUVA_LOCALE` | `pt-BR` | Idioma padrão |
| `NUVA_IMAGE_TAG` | `latest` | Etiqueta das imagens |
| `NUVA_TEST_DB` | vazio | `local` liga o banco de testes clonado ([032](032-verificacao-e-ci.md)) |
| `ADMIN_EMAIL` | segredo | E-mail do admin inicial |
| `ADMIN_PASSWORD` | segredo | Senha do admin inicial |
| `POSTGRES_DB` | `nuva_edu` | Banco |
| `POSTGRES_USER` | `nuva_edu` | Usuário |
| `POSTGRES_PASSWORD` | segredo | Senha do banco |
| `DATABASE_URL` | montada das três acima | Conexão usada pelas aplicações |
| `NUVA_POSTGRES_PORT` | `5432` | Porta em `127.0.0.1` no desenvolvimento |
| `SESSION_SECRET` | segredo | Assinatura de cookies e tokens |
| `SMTP_HOST` | `mailpit` | Servidor SMTP |
| `SMTP_PORT` | `1025` | Porta SMTP |
| `SMTP_USER` | vazio | Usuário SMTP |
| `SMTP_PASSWORD` | vazio (segredo quando usado) | Senha SMTP |
| `SMTP_FROM` | `nuva-edu <no-reply@${NUVA_DOMAIN}>` | Remetente |
| `MP_ACCESS_TOKEN` | segredo | Mercado Pago |
| `MP_PUBLIC_KEY` | vazio | Mercado Pago (chave pública) |
| `MP_WEBHOOK_SECRET` | segredo | Assinatura dos webhooks |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | vazio | Login Google; vazio desliga o provedor |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | vazio | Login Facebook; vazio desliga |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | vazio | Login Apple; vazio desliga |
| `TRAEFIK_NETWORK` | `nuva-edu-proxy` | Rede do proxy |
| `TRAEFIK_NETWORK_EXTERNAL` | `false` | `true` quando a rede pertence a um Traefik já instalado (o Compose não a cria) |
| `TRAEFIK_ENTRYPOINTS` | `web` | Entrypoints dos roteadores |
| `TRAEFIK_CERTRESOLVER` | vazio | Resolvedor de certificado; vazio = sem TLS |
| `TRAEFIK_HTTP_PORT`, `TRAEFIK_HTTPS_PORT` | `8080`, `8443` | Portas do Traefik próprio |
| `TRAEFIK_ACME_EMAIL` | vazio | E-mail do Let's Encrypt no Traefik próprio |
| `TRUSTED_PROXIES` | faixas privadas | Origens confiáveis para o IP real |
| `NUVA_RETENTION_SESSION_DAYS` | `30` | Sessão sem uso |
| `NUVA_RETENTION_EMAIL_TOKEN_HOURS` | `24` | Links de confirmação e de redefinição |
| `NUVA_RETENTION_LOGIN_ATTEMPT_DAYS` | `30` | Tentativas de login |
| `NUVA_RETENTION_JOB_DONE_DAYS`, `NUVA_RETENTION_JOB_FAILED_DAYS` | `7`, `30` | Tarefas da fila concluídas e com falha |
| `NUVA_RETENTION_NOTIFICATION_DAYS`, `NUVA_RETENTION_NOTIFICATION_UNREAD_DAYS` | `90`, `180` | Notificações lidas e não lidas |
| `NUVA_RETENTION_EMAIL_SENT_DAYS`, `NUVA_RETENTION_EMAIL_FAILED_DAYS` | `30`, `90` | E-mails enviados e com falha |
| `NUVA_RETENTION_WEBHOOK_DAYS` | `90` | Webhooks recebidos |
| `NUVA_RETENTION_AUDIT_DAYS` | `730` | Auditoria |
| `NUVA_RETENTION_MODERATION_DAYS` | `730` | Denúncias, ações de moderação e suspensões |
| `NUVA_RETENTION_CART_DAYS` | `30` | Carrinhos abandonados |
| `NUVA_RETENTION_FISCAL_YEARS` | `5` | Registros de venda ([030](030-lgpd.md), [033](033-observabilidade-retencao-backup.md)) |
| `NUVA_ENV` | `development` | `development`, `test` ou `production`; em `production` o admin é avisado se o pagamento estiver em modo de teste ([013](013-pagamentos-mercado-pago.md)) |
| `NUVA_PAYMENT_PROVIDER` | `mercadopago` | Provedor de pagamento ativo ([013](013-pagamentos-mercado-pago.md)) |
| `NUVA_ORDER_PENDING_MINUTES`, `NUVA_ORDER_BOLETO_DAYS` | `30`, `3` | Prazo do pedido pendente: cartão e Pix; boleto ([011](011-vendas-e-checkout.md)) |
| `NUVA_SUBSCRIPTION_GRACE_DAYS` | `3` | Carência da assinatura com cobrança recusada ([012](012-assinaturas.md)) |
| `NUVA_WORKER_CONCURRENCY` | `10` | Tarefas simultâneas do worker ([005](005-worker-e-fila.md)) |
| `NUVA_BACKUP_CRON`, `NUVA_BACKUP_DIR`, `NUVA_BACKUP_KEEP_DAILY`, `NUVA_BACKUP_KEEP_WEEKLY` | `30 2 * * *`, volume `backup-data`, `7`, `4` | Horário, destino e retenção do backup ([033](033-observabilidade-retencao-backup.md)) |
| `NUVA_MCP_RATE_PER_MIN`, `NUVA_MCP_MAX_KEYS` | `120`, `20` | Limites do MCP ([027](027-mcp.md)) |
| `NUVA_IMAGE_MAX_UPLOAD_MB`, `NUVA_CASE_MAX_IMAGES`, `NUVA_IMAGE_UPLOADS_PER_HOUR` | `5`, `8`, `30` | Limites de imagem ([029](029-imagens.md)) |
| `NUVA_ACCOUNT_DELETION_GRACE_DAYS` | `7` | Carência da exclusão de conta ([030](030-lgpd.md)) |
| `NUVA_LOG_LEVEL` | `info` | Nível de log |
| `NUVA_DEPLOY_SSH_USER`, `NUVA_DEPLOY_SSH_HOST`, `NUVA_DEPLOY_SSH_PORT` | sem padrão | Acesso SSH usado só pelo `pnpm deploy:test`; ficam no `.env.local` |
| `NUVA_<SERVICO>_CPUS`, `NUVA_<SERVICO>_MEMORY` | tabela de serviços | Limites por contêiner |

Segredos de Mercado Pago e de SMTP usam `${VAR:?}` apenas nos serviços que os exigem; em desenvolvimento, o `.env.local` de exemplo traz valores de teste.

### Comandos

- `pnpm compose <args>` — `docker compose` com os arquivos de ambiente corretos.
- `pnpm dev:up` / `pnpm dev:down` — sobe e derruba o ambiente local com os perfis `traefik` e `mailpit`.
- `pnpm db:migrate` — aplica migrations pendentes.
- `pnpm deploy:test` — publica no servidor de testes.

## Dados

- Volumes nomeados: `postgres-data`, `backup-data`, `traefik-acme`.
- Nenhuma aplicação grava em disco: imagens e exportações ficam no banco.
- No servidor de testes, os arquivos ficam em `/opt/nuva-edu`.

## Critérios de aceite

- [ ] `docker compose config` na raiz é válido e o arquivo raiz contém apenas `include:`.
- [ ] Sem `POSTGRES_PASSWORD`, o Compose falha citando a variável.
- [ ] Com os perfis `traefik` e `mailpit`, os dois sites respondem em `*.localhost:8080` no Docker Desktop.
- [ ] Sem o perfil `traefik` e com `TRAEFIK_NETWORK=network_public`, os contêineres entram na rede externa e nenhum publica porta.
- [ ] Todos os contêineres rodam com raiz somente leitura, limites de CPU e memória e `nofile` definidos (teste lê o `docker compose config`).
- [ ] Requisição com `X-Forwarded-For` forjado, vinda de fora de `TRUSTED_PROXIES`, é registrada com o IP da conexão.
- [ ] As cinco imagens existem no Docker Hub com manifesto para `amd64` e `arm64`.
- [ ] `pnpm deploy:test` deixa os dois hosts de teste respondendo `/healthz` por HTTPS com certificado válido.
- [ ] Trocar `NUVA_ADMIN_HOST` e subir de novo muda o host do admin sem refazer imagem.

## Fora de escopo

- Kubernetes, Swarm e instalação sem Docker.
- Mais de um nó ou réplicas das APIs.
- Deploy automático a partir do CI.
- Gestão de DNS e emissão de certificados fora do Traefik.
- Alterar a configuração do Traefik compartilhado do servidor de testes.

## Decisões relacionadas

- [0015 — Traefik próprio opcional](decisions/0015-traefik-proprio-opcional.md)
- [0003 — Instalável, single-tenant](decisions/0003-instalavel-single-tenant.md)
- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
- [0008 — Fila e SSE no PostgreSQL (provisória)](decisions/0008-fila-e-sse-no-postgres.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
