# 031 — Infraestrutura e deploy

Status: aprovada
Depende de: 001, 003, 004, 005, 006

## Contexto

O nuva-edu é distribuído como imagens Docker e um conjunto de arquivos Compose. A mesma estrutura serve ao desenvolvimento (Docker Desktop), ao servidor de testes (que já tem um Traefik compartilhado) e à instalação de cada escola. Esta spec fixa a organização dos arquivos, os padrões de contêiner, as variáveis de ambiente e o caminho de publicação.

## Requisitos

- RF-01: Um único `docker compose up -d` na raiz sobe uma instalação completa, com proxy próprio, a partir de `.env` e `.env.local`.
- RF-02: Cada sistema tem o seu `docker-compose.yml` na própria pasta; o `docker-compose.yml` da raiz apenas os inclui (`include:`).
- RF-03: O Traefik próprio, o backup, o Mailpit e o provedor OAuth simulado são perfis opcionais.
- RF-04: Os nomes de host dos dois sites vêm de variáveis de ambiente.
- RF-05: Nenhuma senha ou chave tem valor padrão: o Compose falha com mensagem clara se faltar (`${VAR:?}`). A exigência de cada segredo entra junto com o código que o usa ([Segredos exigidos](#segredos-exigidos)).
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
| `.dockerignore` | O que fica fora do contexto de build: segredos (`.env*`, chaves), `node_modules`, testes, `specs/`, `docs/`, `e2e/`, `scripts/`, `tasks/`, `tmp/` |
| `database/postgres/docker-compose.yml` | `postgres` e, no perfil `backup`, `backup` |
| `database/postgres/migrations/` | Arquivos `.sql` numerados |
| `proxy/traefik/docker-compose.yml` | `traefik` (perfil `traefik`) |
| `proxy/lighttpd/` | lighttpd dos dois sites, igual nas duas imagens ([0023](decisions/0023-lighttpd-nos-sites.md)): `lighttpd.conf`, o script de entrada, que gera o `/config.json` na subida ([Configuração de execução dos sites](#configuração-de-execução-dos-sites)), e o gerador da CSP, que no build calcula a `Content-Security-Policy` do site a partir do `index.html` ([033](033-observabilidade-retencao-backup.md)) |
| `mail/mailpit/docker-compose.yml` | `mailpit` (perfil `mailpit`) |
| `scripts/oauth-mock/` | Provedor OAuth simulado ([0024](decisions/0024-provedor-oauth-simulado.md)): o servidor e o `docker-compose.yml` do serviço `oauth-mock` (perfil `oauth-mock`) |
| `apps/<app>/docker-compose.yml` | Um por aplicação: `admin-api`, `classroom-api`, `worker`, `admin`, `classroom`. O da `admin-api` traz também o `migrate`, que usa a imagem e o `build` dela |
| `apps/<app>/Dockerfile` | Build em stages, com a raiz do repositório como contexto |

O `docker-compose.yml` da raiz declara também o nome do projeto (`nuva-edu`) e as duas redes: `internal` (banco e comunicação entre serviços) e `public` (a do proxy, `TRAEFIK_NETWORK`).

### Arquivos de ambiente

O Compose lê `.env` e depois `.env.local`, de duas formas:

- **Interpolação** (`${VAR}` nos arquivos Compose): `--env-file .env --env-file .env.local`, encapsulado em `pnpm compose`, `pnpm dev:up` e `pnpm dev:down`. Chamar `docker compose` direto, sem os dois `--env-file`, não lê o `.env.local`.
- **Entrega ao contêiner** (`env_file`): `admin-api`, `classroom-api`, `worker` e `migrate` recebem os dois arquivos inteiros; o que o serviço declara em `environment` vale por cima. Os quatro leem a configuração pelo mesmo módulo de `packages/core`, têm o mesmo acesso ao banco e formam um único domínio de confiança, por isso não há lista de variáveis por serviço, em nenhum ambiente.
- Os demais serviços (`admin`, `classroom`, `postgres`, `traefik`, `mailpit`, `backup`) não usam `env_file`: recebem só as variáveis listadas em `environment`. Os sites são servidos ao público e nunca recebem segredo.

Consequências da entrega por `env_file`:

- `PORT` não vai em `.env` nem em `.env.local`: chegaria ao contêiner e tiraria o serviço da porta 3000, que o `healthcheck` e o proxy usam. Quem roda os processos fora do contêiner define `PORT` na linha de comando ou no ambiente do terminal.
- `POSTGRES_HOST` e `NUVA_POSTGRES_PORT` são sobrescritas em `environment` (`postgres` e `5432`): dentro da rede do Compose o banco é sempre `postgres:5432`, e o `NUVA_POSTGRES_PORT` dos arquivos é só a porta publicada no hospedeiro.
- `.env.local` de servidor não leva `NUVA_DEPLOY_SSH_*`: essas variáveis só existem na máquina de quem roda o `pnpm deploy:test`.

### Serviços

| Serviço | Imagem | Porta interna | CPU | Memória | Perfil |
| --- | --- | --- | --- | --- | --- |
| `postgres` | `postgres:18-alpine` | 5432 | 1 | 1024 MB | padrão |
| `migrate` | `nuva-edu-admin-api` (comando de migration) | — | 1 | 256 MB | padrão (execução única) |
| `admin-api` | `nuva-edu-admin-api` | 3000 | 1 | 384 MB | padrão |
| `classroom-api` | `nuva-edu-classroom-api` | 3000 | 1 | 512 MB | padrão |
| `worker` | `nuva-edu-worker` | 3000 (saúde e métricas) | 1 | 640 MB | padrão |
| `admin` | `nuva-edu-admin` | 8080 | 1 | 64 MB | padrão |
| `classroom` | `nuva-edu-classroom` | 8080 | 1 | 64 MB | padrão |
| `traefik` | `traefik:v3` | 8080 / 8443 | 1 | 128 MB | `traefik` |
| `backup` | `postgres:18` com script | — | 1 | 256 MB | `backup` |
| `mailpit` | `axllent/mailpit` | 1025 / 8025 | 1 | 64 MB | `mailpit` |
| `oauth-mock` | `node:26-slim` com `scripts/oauth-mock/` | 8080 | 1 | 64 MB | `oauth-mock` |

CPU e memória de cada serviço são ajustáveis por `NUVA_<SERVICO>_CPUS` e `NUVA_<SERVICO>_MEMORY`, com o nome do serviço em maiúsculas e `_` no lugar do hífen: `POSTGRES`, `MIGRATE`, `ADMIN_API`, `CLASSROOM_API`, `WORKER`, `ADMIN`, `CLASSROOM`, `TRAEFIK`, `BACKUP`, `MAILPIT`, `OAUTH_MOCK`.

O `migrate` executa o comando de migrations que vai dentro da imagem da `admin-api` (`database/postgres/src/cli.ts up`), termina, e só então as APIs e o worker sobem.

As duas APIs e o worker escutam na porta de `PORT` (padrão 3000). No Compose a variável não é definida, nem pode chegar pelos arquivos de ambiente ([Arquivos de ambiente](#arquivos-de-ambiente)): a porta interna é sempre 3000, e é ela que os `healthcheck` e os rótulos do Traefik usam. `PORT` existe para rodar os três processos lado a lado fora do contêiner (desenvolvimento e testes).

### Padrões de todo contêiner

- `deploy.resources.limits` com CPU e memória (tabela acima).
- `read_only: true`; `/run` e `/tmp` em `tmpfs`; escrita apenas em volumes nomeados ([Volumes](#volumes)).
- `ulimits.nofile` explícito: 65536 para `postgres`, `traefik` e as APIs; 4096 para os demais.
- Usuário sem privilégios, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`.
- `healthcheck` em todos; dependências com `condition: service_healthy` (ou `service_completed_successfully` para `migrate`).
- `restart: unless-stopped`, exceto `migrate`.
- Logs com rotação: `json-file`, `max-size: 10m`, `max-file: 5`.
- Só o `traefik` (e, em desenvolvimento, `postgres` e `mailpit`, em `127.0.0.1`) publica portas no hospedeiro. Fora do desenvolvimento o `postgres` não publica porta nenhuma: a publicação é opcional e vem desligada no servidor de testes e na instalação da escola. O compose atual ainda publica `127.0.0.1:${NUVA_POSTGRES_PORT}` em todo ambiente; a tarefa 061 a torna opcional e registra aqui a variável ou o perfil que a liga.

### Dockerfiles

Build em stages, na ordem que favorece o cache:

1. `deps`: copia só `pnpm-lock.yaml`, `pnpm-workspace.yaml` e os `package.json`; instala dependências.
2. `build`: copia o código. Nos sites, roda o `vite build`. Nas APIs e no worker não há compilação: o serviço roda TypeScript direto no Node 26 (`node src/main.ts`), e o estágio só junta o código às dependências de produção e grava a versão.
3. `runtime`: imagem mínima (`node:26-slim` para APIs e worker; Alpine com o lighttpd do pacote da distribuição para os sites), sem pnpm e com usuário sem privilégios. A imagem das APIs e do worker mantém a árvore do workspace (`/app/apps`, `/app/packages`, `/app/database/postgres`), porque o Node só executa `.ts` fora de `node_modules`.

Versão da imagem: o argumento de build `NUVA_VERSION` (SemVer, sem o `v` da tag) é gravado, no estágio `build`, no `package.json` do serviço dentro da imagem das APIs e do worker. É esse `package.json` que o `GET /api/v1/meta` lê para o campo `version` ([003](003-admin-api.md), "Meta"). Sem o argumento, vale a versão que está no repositório. A versão é da imagem, não da instalação: não existe variável de execução que a altere. As imagens dos sites não recebem o argumento; a versão que os sites mostram é a do `/meta`.

Imagem do worker ([0026](decisions/0026-certificado-por-template-html.md)): além do Node, o estágio `runtime` leva o Chromium headless shell na versão do `playwright-core` do lockfile, instalado com as bibliotecas de sistema dele (`playwright install --with-deps --only-shell chromium`, como `root`, antes do `USER node`, com a lista do `apt` apagada no mesmo passo), em `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, e a fonte Inter (OFL-1.1, com o arquivo de licença) registrada no `fontconfig`. O navegador roda com `--disable-dev-shm-usage` e o perfil em `/tmp`, por isso o `tmpfs` de `/tmp` do worker tem 128 MB (os demais seguem o padrão). O limite de memória do worker (640 MB) cobre o Node e um navegador renderizando um PDF por vez. O tamanho da imagem e a contagem do Trivy antes e depois do Chromium ficam registrados em `docs/`, junto das licenças do Chromium, que não passam pelo passo `licencas` por não serem pacote npm. O tamanho medido é o aceito ([0029](decisions/0029-imagem-do-worker-com-playwright-completo.md)): 918 MB em disco e 359 MB compactado no `amd64`, 931 MB e 358 MB no `arm64`, contra 304 MB e 102 MB da base. A lista de dependências do navegador continua sendo a do `--with-deps` do Playwright, com as fontes de reserva, e não uma lista manual de pacotes.

Imagem dos sites ([0023](decisions/0023-lighttpd-nos-sites.md)): o estágio `runtime` parte do Alpine, aplica `apk upgrade` e instala o lighttpd do pacote da distribuição, sem imagem base de terceiros para o servidor; assim a correção de segurança do servidor entra a cada build. O lighttpd só entrega arquivos: roda com usuário sem privilégios, na porta 8080, com a raiz somente leitura. O que ele responde (`index.html` de reserva, `404` nos caminhos de API e de sonda, cache) está em [006](006-sites-e-interface.md), "Interfaces e contratos". O Traefik continua sendo o proxy.

Os sites são estáticos: o que depende da instalação e não vem da API chega em tempo de execução pelo `/config.json`, gerado na subida do contêiner, não no build, para que a mesma imagem sirva a qualquer instalação ([Configuração de execução dos sites](#configuração-de-execução-dos-sites)).

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
| `oauth-mock.${NUVA_DOMAIN}` | todos | `oauth-mock` (só com o perfil `oauth-mock`) |

- `/healthz` é a única sonda roteada para fora, para monitoramento externo; `/readyz` e `/metrics` ficam só na rede interna ([033](033-observabilidade-retencao-backup.md)).
- Os rótulos do Traefik ficam no `docker-compose.yml` de cada aplicação e usam `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINTS` e `TRAEFIK_CERTRESOLVER`.
- Com `TRAEFIK_CERTRESOLVER` vazio, os rótulos de TLS não são emitidos (desenvolvimento em HTTP).
- Prioridade dos roteadores: 30 para os fluxos SSE, 20 para as APIs, 10 para os sites; assim o caminho mais específico vence no mesmo host.
- `/metrics` e `/readyz` não são roteados pelo proxy; se chegarem ao lighttpd de um site, a resposta é `404`, não o `index.html`.

### SSE atrás do proxy

O fluxo `GET /api/v1/stream` de cada API ([003](003-admin-api.md), [004](004-classroom-api.md)) tem um roteador próprio no Traefik: `nuva-edu-classroom-stream` e `nuva-edu-admin-stream`, com regra exata de `Host` e `Path`, apontando para a API do host correspondente. O que é configurado, e onde:

| Garantia | Onde | Como |
| --- | --- | --- |
| Sem compressão | roteador do fluxo | Nenhum middleware; o Traefik só comprime com o middleware `compress`, e a API não comprime o fluxo |
| Sem buffer de resposta | roteador do fluxo e API | Nenhum middleware (o Traefik só segura a resposta com o middleware `buffering`) e o cabeçalho `X-Accel-Buffering: no`, que a API envia para proxies do tipo Nginx no caminho |
| Conexão mantida | API | `ping` a cada 25 s, abaixo do tempo ocioso de proxies, balanceadores e NAT |

- O Traefik não tem tempo limite por roteador: os tempos de leitura, escrita e ociosidade são da entrada (`entryPoints.<nome>.transport.respondingTimeouts`, configuração estática). O nuva-edu não os define: no Traefik próprio valem os padrões do Traefik 3, sem limite para a escrita da resposta (`writeTimeout` 0), e no Traefik compartilhado do servidor de testes a configuração não é nossa. Por isso a spec não promete duração mínima da conexão.
- Se o proxy da instalação limitar a duração da resposta, o fluxo é cortado nesse prazo e o navegador reconecta sozinho com `Last-Event-ID` ([004](004-classroom-api.md), "Reenvio na reconexão"). Nenhuma tela depende de a conexão durar.
- Regra para quem acrescentar middleware (compressão, cabeçalhos, limite de taxa) aos roteadores das APIs: o roteador do fluxo fica de fora.

### IP real do cliente

- As APIs leem `X-Forwarded-For` (e `X-Real-IP` como alternativa) somente quando a conexão vem de um endereço listado em `TRUSTED_PROXIES`; fora disso, vale o endereço da conexão TCP.
- Padrão de `TRUSTED_PROXIES`, as faixas de onde um proxy na mesma máquina ou na mesma rede interna pode chegar:

  | Faixa | O que é |
  | --- | --- |
  | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | Redes privadas (as redes do Docker caem aqui) |
  | `100.64.0.0/10` | CGNAT; usada por redes de sobreposição e balanceadores internos de provedores |
  | `127.0.0.0/8`, `::1/128` | Laço local |
  | `169.254.0.0/16`, `fe80::/10` | Link-local |
  | `fc00::/7` | Endereços locais únicos do IPv6 |

- A variável aceita endereços e faixas CIDR separados por vírgula e, quando definida, substitui a lista padrão inteira.
- O padrão é amplo para funcionar atrás de qualquer proxy sem configuração. O custo: um cliente cujo endereço real está numa dessas faixas (rede interna da escola, cliente atrás do mesmo CGNAT do servidor) é tratado como proxy, e o `X-Forwarded-For` que ele enviar é aceito. Quem atende usuários nessas condições restringe `TRUSTED_PROXIES` à rede do proxy (`TRAEFIK_NETWORK`); o guia de instalação traz o exemplo.
- Do `X-Forwarded-For`, usa-se o endereço mais à direita que não pertence a `TRUSTED_PROXIES`.
- O IP assim obtido alimenta o limite de tentativas de login, a auditoria e os logs.

### Ambientes

| Item | `dev` (Docker Desktop) | `teste` (servidor opencode) |
| --- | --- | --- |
| Perfis | `traefik`, `mailpit`, `oauth-mock` | `mailpit` (Traefik já existe) |
| `NUVA_DOMAIN` | `localhost` | `opencode.tmsoft.com.br` |
| Sites | `http://edu-admin.localhost:8080`, `http://classroom.localhost:8080` | `https://edu-admin.opencode.tmsoft.com.br`, `https://classroom.opencode.tmsoft.com.br` |
| `TRAEFIK_NETWORK` | `nuva-edu-proxy` (criada pelo Compose) | `network_public` (externa) |
| `TRAEFIK_ENTRYPOINTS` | `web` | `websecure` |
| `TRAEFIK_CERTRESOLVER` | vazio | `letsencrypt` |
| E-mail | Mailpit (`http://localhost:8025`) | Mailpit, com a tela só por túnel SSH, até haver SMTP real de teste (credencial do humano); com ele, `SMTP_*` no `.env.local` do servidor e o perfil sai |
| Login social | Provedor simulado (`NUVA_OAUTH_MOCK_URL=http://oauth-mock.localhost:8080`) | Credenciais reais quando o humano as fornecer; até lá, os botões sociais não aparecem |
| Mercado Pago | credenciais de teste | credenciais de teste |
| Imagens | build local | Docker Hub, etiqueta do commit |
| Postgres no hospedeiro | `127.0.0.1:${NUVA_POSTGRES_PORT}` | não publicado (depende da tarefa 061; ver "Padrões de todo contêiner") |

No servidor de testes o Traefik existente redireciona a porta 80 para a 443 e expõe só contêineres com `traefik.enable=true`; o nuva-edu não altera a configuração dele.

"Produção" é a instalação de cada escola: mesmo Compose, perfil `traefik` (ou proxy existente), perfil `backup` recomendado; o passo a passo fica em `docs/`.

### Publicação de imagens

- Repositórios: `tmsoftbrasil/nuva-edu-admin-api`, `-classroom-api`, `-worker`, `-admin`, `-classroom`.
- Plataformas: `linux/amd64` e `linux/arm64`, num único manifesto.
- Etiquetas: `sha-<7 caracteres>` e `main` a cada push na `main`; `X.Y.Z`, `X.Y` e `latest` a cada tag `vX.Y.Z`.
- O Compose usa `NUVA_IMAGE_TAG` (padrão `latest`).
- Versão: o fluxo `images` do CI passa `NUVA_VERSION` como argumento de build das imagens da `admin-api`, da `classroom-api` e do `worker` ([032](032-verificacao-e-ci.md)). Em tag `vX.Y.Z`, o valor é `X.Y.Z`. Em push na `main`, é a versão do `package.json` da raiz seguida de `-sha-<7 caracteres>` (por exemplo `0.3.0-sha-0940e32`), que é um SemVer de pré-lançamento válido e diz de qual commit a imagem saiu.
- No build local (`pnpm dev:up`), `NUVA_VERSION` fica vazio e o `/meta` mostra a versão do repositório.

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
| `NUVA_ADMIN_HOST` | `edu-admin.${NUVA_DOMAIN}` | Host do site admin ([Padrão dos hosts](#padrão-dos-hosts)) |
| `NUVA_CLASSROOM_HOST` | `classroom.${NUVA_DOMAIN}` | Host do classroom ([Padrão dos hosts](#padrão-dos-hosts)) |
| `NUVA_PUBLIC_SCHEME` | `http` | `http` ou `https`, para montar URLs em e-mails e retornos |
| `NUVA_PUBLIC_PORT` | `8080` | Porta pública; vazio quando 80/443 |
| `NUVA_CURRENCY` | `BRL` | Moeda da instalação |
| `NUVA_LOCALE` | `pt-BR` | Idioma padrão, como etiqueta BCP 47 (`^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`, sem diferenciar maiúsculas). A configuração guarda a forma canônica (`pt-br` vira `pt-BR`), e é ela que o `/meta` devolve |
| `PORT` | `3000` | Porta de escuta das duas APIs e do worker; não é definida no Compose |
| `NUVA_IMAGE_TAG` | `latest` | Etiqueta das imagens |
| `NUVA_VERSION` | vazio | Só no build: versão gravada nas imagens das APIs e do worker ([Dockerfiles](#dockerfiles)); não é lida em execução |
| `NUVA_TEST_DB` | vazio | `local` liga o banco de testes clonado ([032](032-verificacao-e-ci.md)) |
| `ADMIN_EMAIL` | segredo | E-mail do admin inicial |
| `ADMIN_PASSWORD` | segredo | Senha do admin inicial |
| `POSTGRES_DB` | `nuva_edu` | Banco |
| `POSTGRES_USER` | `nuva_edu` | Usuário |
| `POSTGRES_PASSWORD` | segredo | Senha do banco |
| `POSTGRES_HOST` | `127.0.0.1` | Endereço do banco para os processos; no Compose é sempre `postgres` |
| `DATABASE_URL` | montada de `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST` e `NUVA_POSTGRES_PORT` | Conexão usada pelas aplicações; definida, vale no lugar das cinco |
| `NUVA_POSTGRES_PORT` | `5432` | Porta do banco para os processos fora do contêiner e porta publicada em `127.0.0.1` no desenvolvimento; no Compose os serviços usam sempre `5432` |
| `POSTGRES_IMAGE`, `POSTGRES_MAX_CONNECTIONS`, `POSTGRES_SHARED_BUFFERS`, `POSTGRES_SHM_SIZE` | `postgres:18-alpine`, `100`, `256MB`, `128mb` | Imagem e ajustes do contêiner do banco |
| `SESSION_SECRET` | segredo | Assinatura do cookie de retorno do login social ([007](007-contas-e-autenticacao.md), "Cookies"); no mínimo 32 caracteres, senão o serviço não sobe. Gerar com `openssl rand -base64 48` |
| `SMTP_HOST` | `mailpit` | Servidor SMTP |
| `SMTP_PORT` | `1025` | Porta SMTP |
| `SMTP_USER` | vazio | Usuário SMTP |
| `SMTP_PASSWORD` | vazio (segredo quando usado) | Senha SMTP |
| `SMTP_FROM` | `nuva-edu <no-reply@${NUVA_DOMAIN}>` | Remetente |
| `MAILPIT_UI_PORT` | `8025` | Porta da tela do Mailpit em `127.0.0.1` (perfil `mailpit`) |
| `MP_ACCESS_TOKEN` | segredo | Mercado Pago |
| `MP_PUBLIC_KEY` | vazio | Mercado Pago (chave pública) |
| `MP_WEBHOOK_SECRET` | segredo | Assinatura dos webhooks |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | vazio | Login Google; vazio desliga o provedor |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | vazio | Login Facebook; vazio desliga |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | vazio | Login Apple; vazio desliga. `APPLE_PRIVATE_KEY` é o conteúdo PEM da chave `.p8`, com `\n` no lugar das quebras de linha |
| `NUVA_OAUTH_MOCK_URL`, `NUVA_OAUTH_MOCK_INTERNAL_URL` | vazio; o interno, igual ao público | Liga o provedor simulado no lugar dos três ([0024](decisions/0024-provedor-oauth-simulado.md)); recusado com `NUVA_ENV=production`. No Compose de desenvolvimento: `http://oauth-mock.localhost:8080` e `http://oauth-mock:8080` |
| `TRAEFIK_NETWORK` | `nuva-edu-proxy` | Rede do proxy |
| `TRAEFIK_NETWORK_EXTERNAL` | `false` | `true` quando a rede pertence a um Traefik já instalado (o Compose não a cria) |
| `TRAEFIK_ENTRYPOINTS` | `web` | Entrypoints dos roteadores |
| `TRAEFIK_CERTRESOLVER` | vazio | Resolvedor de certificado; vazio = sem TLS |
| `TRAEFIK_HTTP_PORT`, `TRAEFIK_HTTPS_PORT` | `8080`, `8443` | Portas do Traefik próprio |
| `TRAEFIK_ACME_EMAIL` | vazio | E-mail do Let's Encrypt no Traefik próprio |
| `TRAEFIK_IMAGE` | `traefik:v3` | Imagem do Traefik próprio |
| `TRUSTED_PROXIES` | faixas privadas, CGNAT, laço local e link-local | Origens confiáveis para o IP real ([IP real do cliente](#ip-real-do-cliente)) |
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
| `NUVA_PAYMENT_FAKE_URL` | vazio | Origem HTTP interna de um simulador de pagamentos compartilhado. Só aceita com `NUVA_PAYMENT_PROVIDER=fake` em desenvolvimento ou teste ([013](013-pagamentos-mercado-pago.md)) |
| `NUVA_ORDER_PENDING_MINUTES`, `NUVA_ORDER_BOLETO_DAYS` | `30`, `3` | Prazo do pedido pendente: cartão e Pix; boleto ([011](011-vendas-e-checkout.md)) |
| `NUVA_SUBSCRIPTION_GRACE_DAYS` | `3` | Carência da assinatura com cobrança recusada ([012](012-assinaturas.md)) |
| `NUVA_WORKER_CONCURRENCY` | `10` | Tarefas simultâneas do worker ([005](005-worker-e-fila.md)) |
| `NUVA_BACKUP_CRON`, `NUVA_BACKUP_DIR`, `NUVA_BACKUP_KEEP_DAILY`, `NUVA_BACKUP_KEEP_WEEKLY` | `30 2 * * *`, volume `backup-data`, `7`, `4` | Horário, destino e retenção do backup ([033](033-observabilidade-retencao-backup.md)) |
| `NUVA_MCP_RATE_PER_MIN`, `NUVA_MCP_MAX_KEYS` | `120`, `20` | Limites do MCP ([027](027-mcp.md)) |
| `NUVA_IMAGE_MAX_UPLOAD_MB`, `NUVA_CASE_MAX_IMAGES`, `NUVA_IMAGE_UPLOADS_PER_HOUR` | `5`, `8`, `30` | Limites de imagem ([029](029-imagens.md)) |
| `NUVA_ACCOUNT_DELETION_GRACE_DAYS` | `7` | Carência da exclusão de conta ([030](030-lgpd.md)) |
| `NUVA_LOG_LEVEL` | `info` | Nível de log |
| `NUVA_LOG_MAX_SIZE`, `NUVA_LOG_MAX_FILE` | `10m`, `5` | Rotação dos logs dos contêineres |
| `NUVA_DEPLOY_SSH_USER`, `NUVA_DEPLOY_SSH_HOST`, `NUVA_DEPLOY_SSH_PORT` | sem padrão | Acesso SSH usado só pelo `pnpm deploy:test`; ficam no `.env.local` |
| `NUVA_<SERVICO>_CPUS`, `NUVA_<SERVICO>_MEMORY` | tabela de serviços | Limites por contêiner (`NUVA_MIGRATE_CPUS`, `NUVA_ADMIN_API_MEMORY`, ...) |

### Segredos exigidos

O Compose exige um segredo (`${VAR:?}`) só nos serviços que o usam e só a partir da fase em que o código passa a usá-lo; exigir antes obrigaria a preencher valor que ninguém lê.

| Segredo | Exigido em | A partir de |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `postgres`, `migrate`, `admin-api`, `classroom-api`, `worker` (e `backup`, quando existir) | Fase 0 (já exigido) |
| `SESSION_SECRET` | `admin-api`, `classroom-api` | Fase 1 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin-api` | Fase 1 ([007](007-contas-e-autenticacao.md), "Admin inicial") |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | serviços que falam com o Mercado Pago ([013](013-pagamentos-mercado-pago.md)) | Fase 3 |
| `SMTP_PASSWORD` | serviço que envia e-mail ([024](024-notificacoes-e-email.md)) | Fase 1, e só quando `SMTP_USER` está definido: a checagem é do serviço, não do Compose |

- A mensagem do `${VAR:?}` cita a variável e o arquivo: `defina POSTGRES_PASSWORD em .env.local`.
- O `.env.example` lista todos desde já, para o `.env.local` nascer completo.
- A tarefa que liga cada exigência pertence ao `infra` e é criada com as tarefas da fase ([PLAN](PLAN.md)).

### Configuração de execução dos sites

Os sites são arquivos estáticos e a mesma imagem serve a qualquer instalação. O que o navegador precisa saber da instalação chega por dois canais, e cada dado tem uma única fonte:

| Dado | Fonte | Motivo |
| --- | --- | --- |
| Nome, logotipo e cor da escola, endereço do código-fonte | `GET /api/v1/meta` | Vêm de `settings`, mudam sem reiniciar nada |
| Moeda (`currency`) e idioma (`locale`) | `GET /api/v1/meta` | A API valida e normaliza `NUVA_CURRENCY` e `NUVA_LOCALE`; é o mesmo valor que ela usa em preços e e-mails |
| Versão (`version`) | `GET /api/v1/meta` | É a da imagem da API ([Dockerfiles](#dockerfiles)) |
| Provedores de login (`authProviders`) | `GET /api/v1/meta` | Dependem dos segredos, que só a API conhece |
| Qual site é este e o endereço público dos dois sites | `/config.json` | A API de um site não é chamada pelo outro, e o endereço do outro site é necessário mesmo com a API fora do ar |

`/config.json` é servido pelo lighttpd do próprio site, na raiz, com `Content-Type: application/json` e `Cache-Control: no-store`:

```json
{
  "app": "admin",
  "adminUrl": "https://edu-admin.escola.com.br",
  "classroomUrl": "https://classroom.escola.com.br"
}
```

| Campo | Tipo | Origem |
| --- | --- | --- |
| `app` | `admin` ou `classroom` | `NUVA_APP`, fixada na imagem de cada site |
| `adminUrl` | URL de origem, sem barra no fim | `NUVA_PUBLIC_SCHEME`, `NUVA_ADMIN_HOST`, `NUVA_PUBLIC_PORT` |
| `classroomUrl` | URL de origem, sem barra no fim | `NUVA_PUBLIC_SCHEME`, `NUVA_CLASSROOM_HOST`, `NUVA_PUBLIC_PORT` |

- A URL segue a mesma regra de `packages/core`: a porta some quando está vazia ou é a padrão do esquema (80 em `http`, 443 em `https`).
- O arquivo é gerado na subida do contêiner pelo script de entrada de `proxy/lighttpd/`, em `/run/nuva/config.json` (`tmpfs`). O script valida cada variável; valor fora do formato impede a subida, com a variável citada no log. Trocar `NUVA_ADMIN_HOST` e subir de novo muda o arquivo sem refazer a imagem.
- O arquivo é público: nunca contém segredo nem dado de usuário. Campo novo só entra se não puder vir do `/meta`, e entra nesta tabela.
- O `healthcheck` dos contêineres dos sites pede `/config.json`: site sem o arquivo não fica saudável.
- Fora do contêiner (`vite dev`), o servidor de desenvolvimento de cada site responde `/config.json` com os mesmos campos, montados das mesmas variáveis e dos mesmos padrões.
- Uso pelos sites: [006](006-sites-e-interface.md), "Configuração de execução".

### Padrão dos hosts

O padrão de `NUVA_ADMIN_HOST` e de `NUVA_CLASSROOM_HOST` deriva de `NUVA_DOMAIN` em todo lugar que lê essas variáveis: `packages/core` (configuração das APIs e do worker), o script de entrada de `proxy/lighttpd/` (`/config.json`), os rótulos do Traefik e o `environment` dos arquivos Compose. Definir só `NUVA_DOMAIN=escola.com.br` basta para os dois sites responderem em `edu-admin.escola.com.br` e `classroom.escola.com.br`; os dois hosts só precisam ser informados quando fogem desse formato.

- No Compose, a forma é `${NUVA_ADMIN_HOST:-edu-admin.${NUVA_DOMAIN:-localhost}}` (idem `classroom`), a mesma expressão nos rótulos do Traefik e no ambiente dos serviços. Padrão fixo em `edu-admin.localhost` é erro: com `NUVA_DOMAIN` definido e os hosts não, as APIs montariam URLs de um domínio e o proxy rotearia outro.
- Os arquivos Compose atuais ainda usam o padrão fixo (`edu-admin.localhost`, `classroom.localhost`); a tarefa 089 (`infra`) os corrige, com teste em `scripts/compose.test.mjs`. Até lá, fora do desenvolvimento, informe os dois hosts junto com `NUVA_DOMAIN`.

### Configurações da escola

O que a escola ajusta sem reiniciar nada fica na tabela `settings`, uma linha por chave, com o valor em JSON. Variável de ambiente é para o que depende da instalação (hosts, segredos, limites); `settings` é para o que o admin muda pela tela de configurações.

| Chave | Valor (JSON) | Padrão | Uso |
| --- | --- | --- | --- |
| `school.name` | texto de 1 a 120 caracteres, sem espaços nas pontas | `nuva-edu` | `schoolName` do `/meta`, título dos sites, e-mails, certificados |
| `school.timezone` | texto: fuso IANA | `America/Sao_Paulo` | Horário das tarefas recorrentes ([005](005-worker-e-fila.md)), retenção ([033](033-observabilidade-retencao-backup.md)) e padrão do usuário sem fuso próprio ([014](014-aprendizado-e-progresso.md)) |
| `school.logo_image_id` | uuid de uma imagem de finalidade `school_logo` ([029](029-imagens.md)) ou nulo | nulo | `logoUrl` do `/meta`, e-mails |
| `school.accent_color` | texto `#RRGGBB` ou nulo | nulo | `accentColor` do `/meta` |
| `school.email_footer` | texto de até 500 caracteres, sem espaços nas pontas, com quebras de linha permitidas, ou nulo; vazio vale nulo | nulo | Rodapé dos e-mails de notificação ([024](024-notificacoes-e-email.md), "E-mail"); nulo omite o rodapé |
| `school.source_code_url` | texto: URL `https` | `https://github.com/patrickbrandao/nuva-edu` | `sourceCodeUrl` do `/meta`, link "Código-fonte" ([006](006-sites-e-interface.md), RF-11) |
| `certificate.signer_name` | texto de 1 a 120 caracteres ou nulo | nulo | Nome de quem assina o certificado ([015](015-certificados.md)); nulo omite a assinatura |
| `certificate.signer_role` | texto de 1 a 120 caracteres ou nulo | nulo | Cargo de quem assina, abaixo do nome ([015](015-certificados.md)) |

Regras:

- Formato da chave: `grupo.nome`, em minúsculas com `_` (restrição da tabela). O grupo `school` reúne a identidade da escola; cada spec que criar uma chave a acrescenta nesta tabela, que é a lista única.
- Chave ausente vale o padrão: a instalação nova não tem linha nenhuma e funciona. Nenhuma migration insere configuração.
- Leitura só por `packages/core` (módulo `settings`), que valida o valor e devolve o padrão, com aviso no log, quando ele é inválido. Nenhum serviço lê a tabela diretamente.
- Escrita só pela `admin-api` ([003](003-admin-api.md)), que valida antes de gravar e registra auditoria.
- `settings.timezone`, citado em outras specs, é a chave `school.timezone`.

### Volumes

Os volumes têm nome fixo com o prefixo do projeto, para não colidir com volumes de outros projetos no mesmo Docker (caso do servidor de testes):

| Volume | Declarado em | Conteúdo |
| --- | --- | --- |
| `nuva-edu-postgres-data` | `database/postgres/docker-compose.yml` | Dados do banco |
| `nuva-edu-backup-data` | `database/postgres/docker-compose.yml` (perfil `backup`) | Dumps |
| `nuva-edu-traefik-acme` | `proxy/traefik/docker-compose.yml` | Certificados do Traefik próprio |

Transição de quem já tem os nomes antigos (`postgres-data`, `traefik-acme`, da Fase 0):

- `scripts/volume-migrate.sh` copia `postgres-data` para `nuva-edu-postgres-data` quando: o Compose declara o nome novo, o volume novo não existe, e o antigo existe com o rótulo `com.docker.compose.project=nuva-edu`. Antes da cópia o serviço `postgres` é parado; o volume novo é criado pelo Compose (com os rótulos dele) e recebe a cópia por um contêiner descartável da mesma imagem do Postgres (`cp -a`). O volume antigo nunca é apagado pelo script.
- Em qualquer outro caso o script não faz nada: volume antigo de outro projeto (sem o rótulo) é ignorado, e volume novo já existente não é sobrescrito.
- `pnpm dev:up` chama o script antes de subir. No servidor, `pnpm deploy:test` só migra com a opção `--migrate-volume`; sem ela, se a migração for necessária, para com a instrução (é ação sobre dados do servidor, decidida pelo humano).
- Apagar o volume antigo depois de conferir o banco novo é feito à mão pelo humano (`docker volume rm postgres-data`).
- `traefik-acme` e `backup-data` não são copiados: no desenvolvimento não guardam nada que precise ficar, e o servidor de testes não usa os perfis `traefik` e `backup`.

### Comandos

- `pnpm compose <args>` — `docker compose --env-file .env --env-file .env.local <args>`.
- `pnpm dev:up` / `pnpm dev:down` — sobe (construindo as imagens e esperando a saúde) e derruba o ambiente local com os perfis `traefik`, `mailpit` e `oauth-mock`; os volumes ficam. O `dev:up` faz antes a [migração de volume](#volumes), quando houver.
- `pnpm db:migrate` — aplica migrations pendentes.
- `pnpm deploy:test` — publica no servidor de testes.

## Dados

- Volumes nomeados: [Volumes](#volumes).
- Nenhuma aplicação grava em disco: imagens e exportações ficam no banco.
- No servidor de testes, os arquivos ficam em `/opt/nuva-edu`.

## Critérios de aceite

- [ ] `docker compose config` na raiz é válido e o arquivo raiz contém apenas `include:`.
- [ ] Sem `POSTGRES_PASSWORD`, o Compose falha citando a variável; a partir da Fase 1, o mesmo vale para `SESSION_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
- [ ] Os serviços `admin` e `classroom` não recebem `POSTGRES_PASSWORD` nem outro segredo (teste lê o `docker compose config`).
- [ ] Com a publicação do Postgres desligada, nenhum serviço além do `traefik` publica porta.
- [ ] `/config.json` dos dois sites traz `app`, `adminUrl` e `classroomUrl`, sem cache; host inválido impede a subida do contêiner.
- [ ] Imagem construída com `NUVA_VERSION=1.2.3` responde `version: 1.2.3` no `/meta`.
- [ ] Os fluxos SSE dos dois hosts atravessam o proxy sem compressão nem atraso de entrega, e ficam abertos por mais de 5 minutos só com os `ping`.
- [ ] Com os perfis `traefik` e `mailpit`, os dois sites respondem em `*.localhost:8080` no Docker Desktop.
- [ ] Sem o perfil `traefik` e com `TRAEFIK_NETWORK=network_public`, os contêineres entram na rede externa e nenhum publica porta.
- [ ] Todos os contêineres rodam com raiz somente leitura, limites de CPU e memória e `nofile` definidos (teste lê o `docker compose config`).
- [ ] Requisição com `X-Forwarded-For` forjado, vinda de fora de `TRUSTED_PROXIES`, é registrada com o IP da conexão.
- [ ] Conexão vinda de `100.64.0.1` ou de `169.254.0.1` tem o `X-Forwarded-For` aceito com a lista padrão, e recusado com `TRUSTED_PROXIES` restrito a outra faixa.
- [ ] `NUVA_LOCALE=pt-br` sobe o serviço e o `/meta` responde `locale: pt-BR`.
- [ ] Banco sem nenhuma linha em `settings`: o `/meta` devolve os padrões e o agendador usa `America/Sao_Paulo`.
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
- [0023 — lighttpd como servidor de arquivos dos sites](decisions/0023-lighttpd-nos-sites.md)
