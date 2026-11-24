# Ambiente de teste

Derivado de `specs/031-infraestrutura-e-deploy.md` ("Ambientes", "Publicação de imagens" e
"`pnpm deploy:test`"). Em caso de divergência, vale a spec.

O ambiente de teste roda num servidor compartilhado com outros projetos. Ali já existe um Traefik,
com a rede `network_public`, a entrada `websecure` e o resolvedor de certificados `letsencrypt`.
O nuva-edu entra só com rótulos: não sobe proxy próprio e não muda a configuração do que já está
lá.

| Item | Valor |
| --- | --- |
| Sites | `https://edu-admin.opencode.tmsoft.com.br` e `https://classroom.opencode.tmsoft.com.br` |
| Pasta no servidor | `/opt/nuva-edu` |
| Projeto Compose | `nuva-edu` |
| Perfis | nenhum (sem `traefik`, sem `mailpit`) |
| Imagens | Docker Hub, `tmsoftbrasil/nuva-edu-*`, etiqueta do commit (`sha-<7>`) |
| Postgres | só na rede interna; nenhuma porta publicada |

**Regra do servidor:** a única ação permitida sem o aval do humano é o `pnpm deploy:test`.
Qualquer outro comando lá, inclusive os de "Desfazer" abaixo, é decisão do humano.

## Preparação (uma vez)

### Na sua máquina

No `.env.local` do checkout principal (fora do Git), o acesso SSH:

```dotenv
NUVA_DEPLOY_SSH_USER=<usuário>
NUVA_DEPLOY_SSH_HOST=<servidor>
NUVA_DEPLOY_SSH_PORT=<porta>
```

O script usa a sua chave SSH, sem senha (`BatchMode`) e sem encaminhar agente. A chave do servidor
precisa estar no seu `known_hosts`: conecte uma vez à mão antes. Essas três variáveis nunca vão
para o servidor.

### No servidor (feito pelo humano)

Crie a pasta e o `.env.local`. O script nunca cria, envia nem altera esse arquivo; sem ele, para
com as instruções.

```bash
mkdir -p /opt/nuva-edu
install -m 600 /dev/null /opt/nuva-edu/.env.local
```

Conteúdo do `/opt/nuva-edu/.env.local`:

```dotenv
POSTGRES_PASSWORD=<senha forte, só deste ambiente>
NUVA_DOMAIN=opencode.tmsoft.com.br
TRAEFIK_NETWORK=network_public
TRAEFIK_NETWORK_EXTERNAL=true
TRAEFIK_ENTRYPOINTS=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
NUVA_PUBLIC_SCHEME=https
NUVA_PUBLIC_PORT=
NUVA_IMAGE_TAG=main
NUVA_POSTGRES_PUBLISH=false
```

- `NUVA_PUBLIC_PORT=` fica vazia de propósito: sem a linha, valeria o `8080` do `.env` e as URLs
  públicas sairiam com porta.
- `NUVA_IMAGE_TAG` só vale para comandos manuais; o deploy passa a etiqueta pedida por cima.
- `NUVA_POSTGRES_PUBLISH=false` registra a intenção. O deploy não usa o
  `docker-compose.dev.yml`, então o banco não publica porta de nenhum jeito.
- Não ponha `NUVA_DEPLOY_SSH_*`, `COMPOSE_PROFILES`, `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME` nem
  `PORT`: o script recusa.
- Os segredos das próximas fases (`SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e os demais
  de "Segredos exigidos", na spec 031) entram aqui antes do primeiro deploy da fase que os exige.

## Publicar

```bash
pnpm deploy:test                 # sha-<7> do HEAD; exige HEAD = main = origin/main
pnpm deploy:test sha-12c4423     # uma etiqueta específica
pnpm deploy:test --dry-run       # mostra os arquivos e os comandos remotos, sem conectar
pnpm deploy:test main --only admin-api,classroom-api,worker
```

O que acontece, nesta ordem. Até o passo 3, nada muda no servidor.

1. **Etiqueta e arquivos.** Sem etiqueta, usa `sha-<7>` do `HEAD`, que precisa ser a `main` local
   e estar igual a `origin/main`. Os arquivos enviados precisam estar no Git e sem alteração
   pendente.
2. **Imagens.** `docker manifest inspect` em cada imagem da etiqueta. Faltando alguma, para (código
   12) sem conectar ao servidor.
3. **Conferência no servidor, só leitura.** Pasta e `.env.local` existem; o `.env.local` tem o
   que o ambiente de teste exige; a rede do Traefik existe; o volume do banco, se existir, é do
   projeto `nuva-edu`; e não há migração de volume pendente (veja "Migração do volume do banco").
   Do `.env.local` o script lê apenas variáveis não secretas de uma
   lista fixa; da senha, só confere que existe.
4. **Envio.** Um `tar` pela conexão SSH, só com estes arquivos:
   `docker-compose.yml`, `.env` e o `docker-compose.yml` de `database/postgres`, `proxy/traefik`,
   `mail/mailpit` e de cada app. Nenhum código-fonte: as imagens já trazem o código, as
   migrations e a configuração do lighttpd. Os composes do Traefik e do Mailpit vão porque o
   `include:` da raiz os exige; os serviços deles ficam em perfis que o deploy não ativa.
5. **Publicação.** No servidor, sempre com
   `docker compose -p nuva-edu -f docker-compose.yml --env-file .env --env-file .env.local`:
   `pull` das imagens, a cópia do volume do banco (só com `--migrate-volume` e quando necessária) e
   `up -d --no-build --wait` (até 120 s). O `migrate` roda até o fim antes
   das APIs e do worker. `--no-build` garante que nada é construído no servidor, embora os
   composes declarem `build:`.
6. **Conferência pública.** Desta máquina, por HTTPS e validando o certificado: `/healthz` dos
   dois hosts (respondido pelas APIs) e `/config.json` dos dois sites. Na primeira publicação o
   certificado leva alguns segundos; o script tenta por cerca de um minuto.
7. **Resumo:** serviços, imagens, etiqueta e URLs.

Rodar de novo com a mesma etiqueta é seguro: o Compose só recria o contêiner cuja imagem ou
configuração mudou, e o `migrate`, se rodar outra vez, não reaplica migration já aplicada. Em falha, o script mostra o estado e os logs dos serviços e sai com erro.
Não há volta automática: publique a etiqueta anterior (`pnpm deploy:test sha-<anterior>`).

### Deploy parcial (`--only`)

`--only` aceita `admin-api`, `classroom-api`, `worker`, `admin` e `classroom`, separados por
vírgula. É um deploy parcial deliberado: só as imagens dos serviços pedidos são exigidas e só eles
(com `postgres` e `migrate`, quando há backend) são criados ou atualizados. **Os serviços fora da
lista ficam como estão**; se nunca subiram, continuam fora. Com `--only
admin-api,classroom-api,worker` os sites não existem: `/healthz` e `/api/` respondem nos dois
hosts, e o resto devolve 404 do Traefik.

### O que o script garante

- Só usa `docker compose -p nuva-edu`, com a lista explícita de serviços. Não há `docker stop`,
  `prune`, reinício do Traefik nem mudança na rede `network_public`, além de ligar a ela os
  contêineres do próprio projeto.
- Não envia, não sobrescreve e não imprime o `.env.local` do servidor.
- Para antes de subir o banco se já houver, com o nome que o compose do banco declara, um volume
  de outro projeto. O nome é lido do `docker compose config` desta máquina, não fixado no script.
- Só copia volume com `--migrate-volume`, e nunca apaga o volume antigo.

### Migração do volume do banco (`--migrate-volume`)

Os volumes passaram a ter o prefixo do projeto (spec 031, "Volumes"): o banco sai de
`postgres-data` para `nuva-edu-postgres-data`. Quando o compose enviado declara o nome novo, o
servidor ainda não tem o volume novo e tem o `postgres-data` com o rótulo
`com.docker.compose.project=nuva-edu`, subir sem copiar começaria com o banco vazio. Por isso,
nesse caso, o deploy para na conferência (código 19), sem enviar nada, e mostra o comando com a
opção. Rodar a cópia é decisão do humano:

```bash
pnpm deploy:test <etiqueta> --migrate-volume
```

Com a opção, depois do `pull` e antes do `up`, o `scripts/volume-migrate.sh` roda no servidor
(levado pela própria conexão SSH, sem ser gravado lá):

1. confere de novo as três condições; em qualquer outro caso não faz nada;
2. para só o serviço `postgres` do projeto (`docker compose -p nuva-edu stop postgres`): o banco
   fica fora do ar durante a cópia;
3. confere que nenhum contêiner em execução usa o `postgres-data`;
4. num `docker compose run --rm` do próprio `postgres` (mesma imagem e usuário), o Compose cria o
   `nuva-edu-postgres-data` com os rótulos dele e a cópia é feita com `cp -a`, conferida com
   `diff -r`; o `postgres-data` entra só para leitura;
5. o `up` seguinte sobe o banco no volume novo.

Se a cópia falhar, o volume novo, criado nessa execução, é removido; o `postgres-data` fica como
estava e o deploy sai com 17. A opção sem migração pendente não faz nada; com `--only` só de
sites, a migração não roda.

Depois de conferir o banco novo (login no admin, dados presentes), o humano apaga o antigo à
mão, no servidor:

```bash
docker volume rm postgres-data
```

O `nuva-edu-traefik-acme` e o `nuva-edu-backup-data` não são copiados: o servidor de testes não
usa os perfis `traefik` nem `backup`.

### Códigos de saída

| Código | Significado |
| --- | --- |
| 2 | Argumento inválido |
| 10 | Falta `NUVA_DEPLOY_SSH_*` |
| 11 | Git: `HEAD` diferente de `main`/`origin/main`, ou arquivo de deploy alterado |
| 12 | Imagem da etiqueta não existe no Docker Hub (nada foi feito no servidor) |
| 13 | Falha de SSH, ou servidor sem `docker compose` |
| 14 | Falta a pasta ou o `.env.local` no servidor |
| 15 | `.env.local` do servidor impróprio para o ambiente de teste |
| 16 | Rede do Traefik ausente, ou volume do banco de outro projeto |
| 17 | `pull`, cópia do volume ou `up` falhou no servidor |
| 18 | Serviços no ar, mas a URL pública não respondeu |
| 19 | Migração do volume do banco necessária e `--migrate-volume` ausente (nada foi enviado) |
| 20 | Não foi possível ler o volume do banco no `docker compose config` desta máquina |

## E-mail

O ambiente de teste não tem Mailpit, e o `.env` versionado aponta `SMTP_HOST=mailpit`, um nome que
não existe lá. Na Fase 0 isso não afeta nada: nenhum serviço abre conexão SMTP nem a exige para
subir. Quando o envio de e-mail entrar (Fase 1, spec 024), sem SMTP configurado o worker só
registra a falha de envio; para enviar de verdade, o humano põe no `.env.local` do servidor o
SMTP de teste (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`).

## Desfazer

No servidor, pelo humano, em `/opt/nuva-edu`:

```bash
docker compose -p nuva-edu --env-file .env --env-file .env.local down
```

- **Remove:** os contêineres do projeto (`nuva-edu-*`) e a rede `nuva-edu-internal`. Os sites
  saem do ar e o Traefik deixa de rotear os dois hosts.
- **Preserva:** o volume do banco (todos os dados), as imagens baixadas, a pasta
  `/opt/nuva-edu` com o `.env.local`, a rede `network_public`, o Traefik, os certificados e tudo
  dos outros projetos.

Um novo `pnpm deploy:test` recoloca tudo no ar com os mesmos dados.

Apagar também os dados é irreversível e exige decisão explícita do humano:
`docker compose -p nuva-edu --env-file .env --env-file .env.local down --volumes`. Não use
`docker volume prune` nem `docker system prune` nesse servidor: atingem os outros projetos.
