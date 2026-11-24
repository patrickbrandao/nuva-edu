# CI no GitHub Actions

Derivado de `specs/032-verificacao-e-ci.md` ("CI") e `specs/031-infraestrutura-e-deploy.md`
("Publicação de imagens"). Em caso de divergência, vale a spec.

## Fluxos

| Fluxo | Arquivo | Gatilho | O que faz |
| --- | --- | --- | --- |
| `verify` | `.github/workflows/verify.yml` | push na `main`, PR | `pnpm verify:full --e2e` |
| `images` | `.github/workflows/images.yml` | `verify` verde de um push na `main` | Constrói as cinco imagens (amd64 e arm64), passa o Trivy e publica `sha-<7>` e `main` |
| `release` | `.github/workflows/release.yml` | tag `vX.Y.Z` | `verify` e, depois, as imagens `X.Y.Z`, `X.Y` e `latest` |
| `security` | `.github/workflows/security.yml` | push na `main`, segunda-feira, manual | `pnpm audit`, licenças das dependências, CodeQL |

O Dependabot (`.github/dependabot.yml`) abre PRs semanais para npm, Docker e GitHub Actions.

Regras comuns: cada job declara só as permissões de que precisa; uma execução nova no mesmo
ref cancela a anterior (menos em tag); toda ação é fixada pelo SHA do commit, com a versão no
comentário. O teste `scripts/ci.test.mjs` confere isso lendo os YAML.

## `verify`

Roda num runner Linux: Node 26, o pnpm do campo `packageManager`, o Chromium do Playwright e o
Docker do runner (Testcontainers para o banco isolado e o ambiente Compose para o e2e). O job
cria um `.env.local` só com `POSTGRES_PASSWORD`, sorteada na hora; o e2e sobe o ambiente com
`pnpm dev:up`. Não usa segredo: PR de fork roda igual e não publica nada.

Em falha, o log traz o `pnpm compose ps` e o fim dos logs dos contêineres. Os relatórios de
cobertura e do Playwright (`tmp/coverage`, `tmp/playwright`) ficam anexados à execução por 14
dias.

## Imagens

Repositórios `tmsoftbrasil/nuva-edu-{admin-api,classroom-api,worker,admin,classroom}`, um job
por imagem.

| Origem | Etiquetas | `NUVA_VERSION` (só `admin-api`, `classroom-api` e `worker`) |
| --- | --- | --- |
| push na `main` | `sha-<7>`, `main` | `<versão do package.json da raiz>-sha-<7>` |
| tag `vX.Y.Z` | `X.Y.Z`, `X.Y`, `latest` | `X.Y.Z` |

Ordem em cada job: build amd64, conferência da versão gravada na imagem, Trivy, build das duas
plataformas com publicação, conferência do que ficou no Docker Hub (as duas plataformas e a
versão). Vulnerabilidade alta ou crítica com correção disponível falha o job antes de publicar.

### O que o Trivy examina

O Trivy roda com `severity: HIGH,CRITICAL` e `ignore-unfixed: true`, do mesmo jeito nas cinco
imagens e **sem arquivo de exceção**: não há `.trivyignore` nem `.trivyignore.yaml` no
repositório, e o fluxo não passa `trivyignores` nem política alguma. O `scripts/ci.test.mjs`
(`pnpm verify:quick`) falha se um desses arquivos aparecer ou se o passo do Trivy ganhar uma
dessas entradas. Para a imagem não carregar vulnerabilidade da base que o serviço não usa:

- `admin-api`, `classroom-api` e `worker`: o estágio final remove o npm (e o corepack, quando a
  base o traz) de `node:26-slim`. Em execução só o `node` é chamado: serviço, healthcheck,
  `migrate` e `check-contract`.
- `admin` e `classroom`: o estágio final parte do `alpine` puro, roda `apk upgrade --no-cache`
  e instala o `lighttpd` do próprio Alpine (`apk add --no-cache lighttpd`). Não há imagem de
  servidor de terceiros: a correção de um pacote chega pelo repositório do Alpine.

Vulnerabilidade alta ou crítica com correção disponível falha o job. A saída é corrigir a
imagem (base nova, pacote atualizado, pacote removido); abrir exceção é decisão do humano e
começa por uma ADR.

As camadas do `apk upgrade` e do `apk add` ficam no cache do build enquanto o digest da base e
o Dockerfile não mudam. Se o Trivy acusar um pacote do Alpine que já tem correção publicada,
reexecute sem o cache antigo (`gh run rerun <id> --failed` depois de a base `alpine:<versão>`
ganhar digest novo) ou mude o Dockerfile numa tarefa do papel `infra`.

Para conferir uma imagem na máquina, do mesmo jeito que o fluxo:

```bash
docker build -f apps/admin/Dockerfile -t nuva-prova-admin:local .
docker run --rm -v trivy-cache:/root/.cache/ -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.76.2 image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
  nuva-prova-admin:local
docker rmi nuva-prova-admin:local
```

### Segredos

Só dois, cadastrados pelo humano em *Settings → Secrets and variables → Actions*:
`DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` (token de acesso do Docker Hub com escrita nos cinco
repositórios).

- Sem eles, na `main`: as imagens são construídas e examinadas, nada é publicado, e a execução
  mostra o aviso "Imagem não publicada". O job não falha por isso.
- Sem eles, numa tag: o job falha. Release sem imagem não passa.

## `security`

- `pnpm audit --audit-level high`: vulnerabilidade alta ou crítica falha.
- `pnpm licenses:check` (`scripts/check-licenses.mjs`): toda dependência precisa de licença
  listada em `license-allowlist.json`, na raiz. Para aceitar uma licença nova, confirme a
  compatibilidade com a AGPL-3.0 e acrescente-a em `allowed`; para liberar um pacote isolado,
  use `exceptions` com o motivo.
- CodeQL para JavaScript/TypeScript e para os próprios fluxos; os alertas aparecem em
  *Security → Code scanning*.

## Conferir antes de enviar

```bash
node --test scripts/ci.test.mjs
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.12
```

Acompanhar uma execução:

```bash
gh run list --branch main --limit 5
gh run watch <id> --exit-status
gh run view <id> --log-failed
```
