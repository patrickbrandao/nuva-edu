# Ambiente local com Docker

Derivado de `specs/031-infraestrutura-e-deploy.md`. Em caso de divergência, vale a spec.

## Subir e derrubar

```bash
cp .env.example .env.local   # preencha ao menos POSTGRES_PASSWORD
pnpm dev:up                  # constrói as imagens, sobe tudo e espera a saúde
pnpm dev:down                # derruba; os volumes (postgres-data) ficam
```

| Endereço | O que é |
| --- | --- |
| http://edu-admin.localhost:8080 | Site admin; `/api/`, `/mcp` e `/healthz` vão para a admin-api |
| http://classroom.localhost:8080 | Site do aluno; `/api/` e `/healthz` vão para a classroom-api |
| http://localhost:8025 | Mailpit (e-mails enviados em desenvolvimento) |
| `127.0.0.1:${NUVA_POSTGRES_PORT}` | PostgreSQL, para `pnpm db:migrate` e os testes (só no desenvolvimento; veja "Porta do PostgreSQL no hospedeiro") |

`pnpm compose <args>` é o `docker compose` com `--env-file .env --env-file .env.local`:

```bash
pnpm compose ps
pnpm compose logs -f classroom-api
pnpm compose up -d --wait postgres     # só o banco, como os testes precisam
pnpm compose --profile traefik --profile mailpit up -d --build admin   # refaz um serviço
```

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
  `postgres-data`), então avise quem estiver usando o banco.
- Quem passa `-f` próprio ao `pnpm compose` escolhe os arquivos: o de desenvolvimento não entra.
- Use sempre o mesmo caminho (`pnpm compose` ou `docker compose` direto) na mesma máquina: alternar
  entre os dois com a publicação ligada recria o banco a cada troca.

Porta 8080 ocupada por outro projeto: defina `TRAEFIK_HTTP_PORT` e `NUVA_PUBLIC_PORT` com a mesma
porta livre no `.env.local`.

Sem `POSTGRES_PASSWORD` o Compose não sobe e a mensagem cita a variável.

## Como os serviços se ligam

O `docker-compose.yml` da raiz só inclui o compose de cada sistema.

| Serviço | Arquivo | Redes | Observação |
| --- | --- | --- | --- |
| `postgres` | `database/postgres/docker-compose.yml` | interna | Único volume com dados |
| `migrate` | `apps/admin-api/docker-compose.yml` | interna | Imagem da admin-api com `node /app/database/postgres/src/cli.ts up`; roda até o fim antes das APIs e do worker |
| `admin-api`, `classroom-api` | `apps/<app>/docker-compose.yml` | interna e do proxy | Porta 3000 |
| `worker` | `apps/worker/docker-compose.yml` | interna | Porta 3000 só para saúde e métricas |
| `admin`, `classroom` | `apps/<app>/docker-compose.yml` | do proxy | Nginx sem privilégios na porta 8080 |
| `traefik`, `mailpit` | `proxy/traefik/`, `mail/mailpit/` | do proxy; interna | Perfis opcionais |

Todo contêiner (aplicações, `postgres`, `traefik` e `mailpit`) roda com raiz somente leitura,
`/run` e `/tmp` em tmpfs, sem capacidades (`cap_drop: ALL`, sem `cap_add`), `no-new-privileges`,
`healthcheck`, limites de CPU e memória (`NUVA_<SERVICO>_CPUS` e `NUVA_<SERVICO>_MEMORY`) e
`ulimits.nofile` (65536 no `postgres`, no `traefik` e nas APIs; 4096 nos demais). O teste
`scripts/compose.test.mjs` confere isso lendo o `docker compose config`.

O `postgres` roda como o usuário `postgres` da imagem, não como root: assim a entrada da imagem
oficial não precisa de `chown` nem de troca de usuário. Um volume `postgres-data` criado antes
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
- Sites: `vite build` e Nginx (`proxy/nginx/nginx.conf`), com retorno ao `index.html` para as
  rotas da SPA. Na subida, `proxy/nginx/40-nuva-config.sh` gera `/config.json` só com `app`
  (`admin` ou `classroom`), `adminUrl` e `classroomUrl`, a partir de `NUVA_APP` (fixada na
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
  `proxy/nginx/csp.mjs` lê o `dist/index.html` e grava `/etc/nginx/nuva-csp.conf` com o hash do
  script inline do tema; a política só aceita a própria origem (API, SSE, imagens, fontes,
  estilos) e `data:` em imagens. O servidor de desenvolvimento do Vite não envia esse cabeçalho:
  para conferir a política, use a imagem (`pnpm dev:up`).
- `--build-arg NUVA_VERSION=X.Y.Z` grava a versão da release no `package.json` do serviço dentro
  da imagem; é ela que aparece em `/api/v1/meta`. Sem o argumento, vale a versão do repositório.

A primeira construção é demorada: o pnpm confere cada pacote do lockfile no registro antes de
instalar. As seguintes usam o cache de camadas enquanto os `package.json` e o lockfile não mudam.
