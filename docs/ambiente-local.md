# Ambiente local com Docker

Derivado de `specs/031-infraestrutura-e-deploy.md`. Em caso de divergência, vale a spec.

## Subir e derrubar

```bash
cp .env.example .env.local   # preencha os quatro obrigatórios (abaixo)
pnpm dev:up                  # migra o volume do banco, se preciso; constrói, sobe e espera a saúde
pnpm dev:down                # derruba; os volumes ficam
```

| Endereço | O que é |
| --- | --- |
| http://edu-admin.localhost:8080 | Site admin; `/api/`, `/mcp` e `/healthz` vão para a admin-api |
| http://classroom.localhost:8080 | Site do aluno; `/api/` e `/healthz` vão para a classroom-api |
| http://localhost:8025 | Mailpit (e-mails enviados em desenvolvimento) |
| http://oauth-mock.localhost:8080 | Provedor OAuth simulado (Google, Facebook e Apple), perfil `oauth-mock` |
| `127.0.0.1:${NUVA_POSTGRES_PORT}` | PostgreSQL, para `pnpm db:migrate` e os testes (só no desenvolvimento; veja "Porta do PostgreSQL no hospedeiro") |

`pnpm compose <args>` é o `docker compose` com `--env-file .env --env-file .env.local`:

```bash
pnpm compose ps
pnpm compose logs -f classroom-api
pnpm compose up -d --wait postgres     # só o banco, como os testes precisam
pnpm compose --profile traefik --profile mailpit --profile oauth-mock up -d --build admin   # refaz um serviço
```

### Segredos obrigatórios

Sem qualquer um deles o Compose não sobe e a mensagem cita a variável e o `.env.local`
(`defina SESSION_SECRET em .env.local`). Vale para `pnpm dev:up`, `pnpm compose` e o
`docker compose` direto, porque a interpolação é do projeto inteiro.

| Variável | Quem exige | Regra |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `postgres`, `migrate`, APIs e worker | Senha do banco |
| `SESSION_SECRET` | `admin-api`, `classroom-api` | No mínimo 32 caracteres, senão a API não sobe. Gere com `openssl rand -base64 48` |
| `ADMIN_EMAIL` | `admin-api` | E-mail válido do admin inicial |
| `ADMIN_PASSWORD` | `admin-api` | Senha do admin inicial, de 8 a 128 caracteres |

O admin inicial é criado na primeira subida em que o banco não tem admin; depois disso, trocar
`ADMIN_EMAIL` ou `ADMIN_PASSWORD` não muda nada. Evite `$` nos valores (o Compose o interpreta)
ou ponha o valor entre aspas simples.

### Provedor OAuth simulado

O `pnpm dev:up` sobe o serviço `oauth-mock` (`scripts/oauth-mock/`, perfil `oauth-mock`; ADR
0024) e liga o simulador nas duas APIs no lugar de Google, Facebook e Apple. Com
`NUVA_DOMAIN=localhost`, o `pnpm compose`, o `pnpm dev:up` e o `pnpm dev:down` passam ao Compose:

| Variável | Valor | Uso |
| --- | --- | --- |
| `NUVA_OAUTH_MOCK_URL` | `http://oauth-mock.localhost:${TRAEFIK_HTTP_PORT}` | Endereço visto pelo navegador e emissor dos `id_token` |
| `NUVA_OAUTH_MOCK_INTERNAL_URL` | `http://oauth-mock:8080` | Endereço que as APIs usam na rede interna |

- As duas nunca ficam no `.env` versionado, que vai ao servidor: lá e na instalação da escola as
  APIs as recebem vazias e o simulador fica desligado (com `NUVA_ENV=production` a API recusa a
  variável).
- Para trocar os endereços, defina-as no `.env.local`; `NUVA_OAUTH_MOCK_URL=` (vazia) desliga o
  simulador. Mudou: rode `pnpm dev:up` de novo para recriar as APIs.
- Na tela de autorização qualquer um escolhe a identidade; credenciais de teste e endereços em
  `scripts/oauth-mock/README.md`.

### Porta do PostgreSQL no hospedeiro

O serviço `postgres` não publica porta. Quem a publica, em `127.0.0.1:${NUVA_POSTGRES_PORT}`, é o
`docker-compose.dev.yml` da raiz, que o `pnpm compose`, o `pnpm dev:up` e o `pnpm dev:down`
acrescentam (`-f docker-compose.yml -f docker-compose.dev.yml`) conforme `NUVA_POSTGRES_PUBLISH`,
lida do ambiente do processo, do `.env.local` e do `.env`, nessa ordem:

| `NUVA_POSTGRES_PUBLISH` | Resultado |
| --- | --- |
| vazia (padrão) | Publica só quando `NUVA_DOMAIN` é `localhost`, isto é, na máquina de desenvolvimento |
| `true` | Publica, seja qual for o domínio |
| `false` | Não publica |

- Na máquina de desenvolvimento nada muda: `pnpm dev:up`, `pnpm db:migrate` e o `pnpm verify:quick`
  continuam achando o banco na porta de sempre.
- No servidor de testes e na instalação da escola, `NUVA_DOMAIN` é o domínio real e o banco fica
  só na rede interna do Compose. O `docker compose` chamado direto, sem os dois `-f`, também não
  publica.
- Ligar ou desligar: ponha `NUVA_POSTGRES_PUBLISH=true` (ou `false`) no `.env.local` e rode
  `pnpm compose up -d postgres`. O contêiner do banco é recriado (os dados ficam no volume
  do banco), então avise quem estiver usando o banco.
- Quem passa `-f` próprio ao `pnpm compose` escolhe os arquivos: o de desenvolvimento não entra.
- Use sempre o mesmo caminho (`pnpm compose` ou `docker compose` direto) na mesma máquina: alternar
  entre os dois com a publicação ligada recria o banco a cada troca.

Porta 8080 ocupada por outro projeto: defina `TRAEFIK_HTTP_PORT` e `NUVA_PUBLIC_PORT` com a mesma
porta livre no `.env.local`.

Sem um dos [segredos obrigatórios](#segredos-obrigatórios) o Compose não sobe e a mensagem cita
a variável.

## Como os serviços se ligam

O `docker-compose.yml` da raiz só inclui o compose de cada sistema.

| Serviço | Arquivo | Redes | Observação |
| --- | --- | --- | --- |
| `postgres` | `database/postgres/docker-compose.yml` | interna | Único volume com dados |
| `migrate` | `apps/admin-api/docker-compose.yml` | interna | Imagem da admin-api com `node /app/database/postgres/src/cli.ts up`; roda até o fim antes das APIs e do worker |
| `admin-api`, `classroom-api` | `apps/<app>/docker-compose.yml` | interna e do proxy | Porta 3000 |
| `worker` | `apps/worker/docker-compose.yml` | interna | Porta 3000 só para saúde e métricas |
| `admin`, `classroom` | `apps/<app>/docker-compose.yml` | do proxy | lighttpd sem privilégios (usuário 101) na porta 8080 |
| `traefik`, `mailpit` | `proxy/traefik/`, `mail/mailpit/` | do proxy; interna | Perfis opcionais |
| `oauth-mock` | `scripts/oauth-mock/` | interna e do proxy | Perfil `oauth-mock`; `node:26-slim` com o `server.mjs` montado só para leitura, porta 8080 |

Todo contêiner (aplicações, `postgres`, `traefik`, `mailpit` e `oauth-mock`) roda com raiz somente leitura,
`/run` e `/tmp` em tmpfs, sem capacidades (`cap_drop: ALL`, sem `cap_add`), `no-new-privileges`,
`healthcheck`, limites de CPU e memória (`NUVA_<SERVICO>_CPUS` e `NUVA_<SERVICO>_MEMORY`) e
`ulimits.nofile` (65536 no `postgres`, no `traefik` e nas APIs; 4096 nos demais). O teste
`scripts/compose.test.mjs` confere isso lendo o `docker compose config`.

## Volumes e a migração do nome

Os volumes têm nome fixo com o prefixo do projeto (spec 031, "Volumes"): `nuva-edu-postgres-data`
(banco), `nuva-edu-backup-data` (perfil `backup`) e `nuva-edu-traefik-acme` (perfil `traefik`).
Quem vem da Fase 0 tem `postgres-data` e `traefik-acme`.

O `pnpm dev:up` roda antes o `scripts/volume-migrate.sh`, que copia `postgres-data` para o volume
que o compose do banco declara só quando, ao mesmo tempo: o nome declarado é diferente do antigo;
o volume declarado ainda não existe; e o `postgres-data` existe com o rótulo
`com.docker.compose.project=nuva-edu`. Em qualquer outro caso não faz nada (volume antigo de outro
projeto é ignorado; volume novo existente não é sobrescrito), e rodar de novo também não.

Quando copia, o script:

- para **só** o serviço `postgres` do projeto (`docker compose stop postgres`), e só nesse caso:
  quem estiver usando o banco local perde a conexão até o `dev:up` terminar;
- recusa copiar se outro contêiner em execução ainda usar o `postgres-data`;
- deixa o Compose criar o volume novo num `docker compose run --rm` do próprio `postgres` e copia
  com `cp -a` (conferido com `diff -r`); o antigo é montado só para leitura;
- nunca apaga o volume antigo. Se a cópia falhar, remove só o volume novo dessa execução, e o
  `dev:up` para sem subir nada.

Para saber, sem mudar nada, se a cópia é necessária:

```bash
bash scripts/volume-migrate.sh --check -- --env-file .env --env-file .env.local   # 3 = necessária
```

Depois de conferir o banco novo, apague o antigo à mão: `docker volume rm postgres-data`. O
`traefik-acme` não é copiado (no desenvolvimento não guarda nada que precise ficar): apague-o
quando quiser com `docker volume rm traefik-acme`.

## Usuário do Postgres

O `postgres` roda como o usuário `postgres` da imagem, não como root: assim a entrada da imagem
oficial não precisa de `chown` nem de troca de usuário. Um volume do banco criado antes
dessa mudança continua valendo (os dados já pertencem a esse usuário).

`/readyz` e `/metrics` não passam pelo proxy. Para consultá-los:

```bash
pnpm compose exec admin-api node -e "fetch('http://127.0.0.1:3000/readyz').then(async (r) => console.log(r.status, await r.text()))"
```

## Imagens

Cada `apps/<app>/Dockerfile` usa a raiz do repositório como contexto e tem três estágios: `deps`
(só manifestos e lockfile), `build` e `runtime`.

- APIs e worker rodam TypeScript direto no Node 26, sem compilação. A imagem mantém a árvore do
  workspace (`/app/apps`, `/app/packages`, `/app/database/postgres`) porque o Node só executa
  `.ts` fora de `node_modules`.
- Sites: `vite build` e, no estágio final, `alpine` com o `lighttpd` do próprio Alpine
  (`proxy/lighttpd/lighttpd.conf`), rodando como o usuário `nuva` (UID e GID 101, o dono do
  tmpfs `/run` nos composes) na porta 8080. Rotas da SPA caem no `index.html`; `/api/`, `/mcp`,
  `/healthz`, `/readyz` e `/metrics`, a pasta `/assets/` e arquivo de `/assets/` que não existe
  respondem 404. Arquivos de `/assets/` saem com cache longo e imutável, o `index.html` com
  `Cache-Control: no-cache`, e texto acima de 1 KiB vai em gzip. O build confere a configuração
  com `lighttpd -tt`.
- Sites: a entrada do contêiner é `proxy/lighttpd/entrypoint.sh`, que gera
  `/run/nuva/config.json` (tmpfs; a raiz do site tem um atalho para ele) e troca o processo
  pelo lighttpd, que fica como PID 1 e recebe os sinais do Docker. O `/config.json` traz só
  `app` (`admin` ou `classroom`), `adminUrl` e `classroomUrl`, a partir de `NUVA_APP` (fixada na
  imagem), `NUVA_PUBLIC_SCHEME`, `NUVA_ADMIN_HOST`, `NUVA_CLASSROOM_HOST` e `NUVA_PUBLIC_PORT`; a
  porta some da URL quando está vazia ou é a padrão do esquema. Moeda, idioma e versão vêm do
  `GET /api/v1/meta`. O arquivo é público e sai com `Cache-Control: no-store`; os sites não
  recebem segredo nem `env_file`. Valor fora do formato impede a subida, com a variável citada no
  log. Sem `NUVA_ADMIN_HOST` e `NUVA_CLASSROOM_HOST`, o Compose os deriva de `NUVA_DOMAIN`
  (`edu-admin.<domínio>` e `classroom.<domínio>`), com a mesma expressão nos rótulos do Traefik;
  o `.env` versionado só traz `NUVA_DOMAIN=localhost`. Defina `NUVA_DOMAIN` (e os hosts, se
  fugirem do formato) no `.env.local`, não só no ambiente do shell: as APIs e o worker leem os
  arquivos por `env_file`. Trocar `NUVA_ADMIN_HOST` e subir de novo não refaz a imagem; mudança no
  script, porém, só vale depois de reconstruir as imagens dos dois sites (`pnpm dev:up`).
- Sites: o `index.html` sai com `Content-Security-Policy` sem `unsafe-inline`. No build,
  `proxy/lighttpd/csp.mjs` lê o `dist/index.html` e grava `/etc/lighttpd/nuva-csp.conf` com o
  hash do script inline do tema; a política só aceita a própria origem (API, SSE, imagens,
  fontes, estilos) e `data:` em imagens. O servidor de desenvolvimento do Vite não envia esse
  cabeçalho: para conferir a política, use a imagem (`pnpm dev:up`).
- Sites: para conferir a configuração sem subir o ambiente,
  `NUVA_TEST_DOCKER=1 node --test scripts/lighttpd.test.mjs` roda o `lighttpd -tt` num contêiner
  descartável.
- `--build-arg NUVA_VERSION=X.Y.Z` grava a versão da release no `package.json` do serviço dentro
  da imagem; é ela que aparece em `/api/v1/meta`. Sem o argumento, vale a versão do repositório.

A primeira construção é demorada: o pnpm confere cada pacote do lockfile no registro antes de
instalar. As seguintes usam o cache de camadas enquanto os `package.json` e o lockfile não mudam.
