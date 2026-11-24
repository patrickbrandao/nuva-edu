#!/usr/bin/env bash
# pnpm deploy:test [etiqueta] — publica o nuva-edu no servidor de testes (spec 031).
#
# Roda na máquina do desenvolvedor, com o SSH dele. No servidor só age sobre o projeto Compose
# `nuva-edu`, dentro de NUVA_DEPLOY_DIR; não cria nem altera o `.env.local` de lá, não usa os
# perfis `traefik` e `mailpit` e não toca em contêiner, rede ou volume de outro projeto.
# Passo a passo, códigos de saída e como desfazer: docs/ambiente-de-teste.md.
#
# Compatível com o bash 3.2 do macOS.
set -euo pipefail

readonly PROJECT='nuva-edu'
readonly IMAGE_PREFIX='tmsoftbrasil/nuva-edu-'
readonly ALL_SERVICES='admin-api classroom-api worker admin classroom'
# Nome antigo do volume do banco (Fase 0). O nome atual é lido do `docker compose config`
# (database/postgres/docker-compose.yml), não fixado aqui. Spec 031, "Volumes".
readonly LEGACY_POSTGRES_VOLUME='postgres-data'
readonly WAIT_SECONDS=120

# Tudo o que vai para o servidor. Só arquivos Compose e o `.env` versionado: as imagens já trazem
# o código, as migrations e a configuração do lighttpd (nada de `proxy/lighttpd/` é montado).
# Os composes do Traefik e do Mailpit vão porque o `include:` da raiz os exige; os serviços deles
# ficam em perfis que este script nunca ativa.
readonly DEPLOY_FILES='docker-compose.yml
.env
database/postgres/docker-compose.yml
proxy/traefik/docker-compose.yml
mail/mailpit/docker-compose.yml
apps/admin-api/docker-compose.yml
apps/classroom-api/docker-compose.yml
apps/worker/docker-compose.yml
apps/admin/docker-compose.yml
apps/classroom/docker-compose.yml'

# Códigos de saída.
readonly E_USAGE=2 E_CONFIG=10 E_GIT=11 E_IMAGE=12 E_SSH=13 E_REMOTE_ENV=14 E_REMOTE_INVALID=15
readonly E_REMOTE_CONFLICT=16 E_DEPLOY=17 E_HEALTH=18 E_MIGRATION=19 E_COMPOSE=20

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
ENV_FILE="${NUVA_DEPLOY_ENV_FILE:-$ROOT/.env.local}"
DEPLOY_DIR="${NUVA_DEPLOY_DIR:-/opt/nuva-edu}"
DRY_RUN=false
MIGRATE_VOLUME=false
LIST_FILES=false
ONLY=''
TAG=''

usage() {
  cat <<EOF
Uso: pnpm deploy:test [etiqueta] [--only <serviços>] [--migrate-volume] [--dry-run] [--dir <pasta>]

  etiqueta           etiqueta das imagens no Docker Hub (ex.: sha-12c4423, main).
                     Padrão: sha-<7> do HEAD, que precisa ser igual a main e a origin/main.
  --only <serviços>  deploy parcial deliberado: lista separada por vírgula de
                     ${ALL_SERVICES// /, }.
                     Os demais serviços ficam como estão (ou fora, se nunca subiram).
  --migrate-volume   copia o volume antigo do banco (postgres-data) para o nome novo, quando
                     a spec 031 exige ("Volumes"). Para o postgres do projeto durante a cópia
                     e nunca apaga o volume antigo. Sem a opção, o deploy para se a cópia
                     for necessária. Decisão do humano.
  --dry-run          mostra os arquivos e os comandos remotos; não conecta ao servidor.
  --dir <pasta>      pasta no servidor (padrão: /opt/nuva-edu, ou NUVA_DEPLOY_DIR).
  --list-files       lista os arquivos que seriam enviados e sai.

Acesso: NUVA_DEPLOY_SSH_USER, NUVA_DEPLOY_SSH_HOST e NUVA_DEPLOY_SSH_PORT, no ambiente ou no
.env.local desta máquina. Detalhes em docs/ambiente-de-teste.md.
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() {
  local code="$1"
  shift
  printf 'deploy:test: %s\n' "$*" >&2
  exit "$code"
}

# --- argumentos -----------------------------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --migrate-volume) MIGRATE_VOLUME=true ;;
    --list-files) LIST_FILES=true ;;
    --only)
      [ $# -ge 2 ] || die "$E_USAGE" '--only precisa da lista de serviços'
      ONLY="$2"
      shift
      ;;
    --only=*) ONLY="${1#--only=}" ;;
    --dir)
      [ $# -ge 2 ] || die "$E_USAGE" '--dir precisa da pasta'
      DEPLOY_DIR="$2"
      shift
      ;;
    --dir=*) DEPLOY_DIR="${1#--dir=}" ;;
    -h | --help)
      usage
      exit 0
      ;;
    --) ;;
    -*) die "$E_USAGE" "opção desconhecida: $1 (veja --help)" ;;
    *)
      [ -z "$TAG" ] || die "$E_USAGE" "etiqueta informada duas vezes: $TAG e $1"
      TAG="$1"
      ;;
  esac
  shift
done

if $LIST_FILES; then
  say "$DEPLOY_FILES"
  exit 0
fi

case "$DEPLOY_DIR" in
  /*) ;;
  *) die "$E_USAGE" "a pasta no servidor precisa ser absoluta: $DEPLOY_DIR" ;;
esac
[[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "$E_USAGE" "pasta inválida: $DEPLOY_DIR"
[[ "$DEPLOY_DIR" != *..* ]] || die "$E_USAGE" "pasta inválida: $DEPLOY_DIR"
DEPLOY_DIR="${DEPLOY_DIR%/}"
[ -n "$DEPLOY_DIR" ] || die "$E_USAGE" 'a pasta no servidor não pode ser a raiz'

# Serviços pedidos, na ordem canônica.
SERVICES=''
if [ -z "$ONLY" ]; then
  SERVICES="$ALL_SERVICES"
else
  for wanted in ${ONLY//,/ }; do
    case " $ALL_SERVICES " in
      *" $wanted "*) ;;
      *) die "$E_USAGE" "serviço desconhecido em --only: $wanted (use: ${ALL_SERVICES// /, })" ;;
    esac
  done
  for service in $ALL_SERVICES; do
    case " ${ONLY//,/ } " in
      *" $service "*) SERVICES="${SERVICES:+$SERVICES }$service" ;;
    esac
  done
  [ -n "$SERVICES" ] || die "$E_USAGE" '--only veio sem serviço'
fi

has_service() {
  case " $SERVICES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Imagens necessárias: a de cada serviço pedido e, com qualquer backend, a da admin-api, que é a
# imagem do `migrate` (dependência das APIs e do worker).
IMAGES=''
BACKEND=false
if has_service admin-api || has_service classroom-api || has_service worker; then
  BACKEND=true
  IMAGES='admin-api'
fi
for service in $SERVICES; do
  case " $IMAGES " in
    *" $service "*) ;;
    *) IMAGES="${IMAGES:+$IMAGES }$service" ;;
  esac
done

# --- acesso SSH ------------------------------------------------------------------------------

# Lê uma variável do ambiente e, na falta, do .env.local desta máquina. O arquivo não é
# executado nem carregado inteiro: só a linha da variável pedida é lida.
local_setting() {
  local name="$1" value="${!1:-}"
  if [ -z "$value" ] && [ -f "$ENV_FILE" ]; then
    value="$(sed -n "s/^[[:space:]]*$name=//p" "$ENV_FILE" | tail -n 1)"
    value="${value%$'\r'}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi
  printf '%s' "$value"
}

SSH_USER="$(local_setting NUVA_DEPLOY_SSH_USER)"
SSH_HOST="$(local_setting NUVA_DEPLOY_SSH_HOST)"
SSH_PORT="$(local_setting NUVA_DEPLOY_SSH_PORT)"

missing=''
[ -n "$SSH_USER" ] || missing="$missing NUVA_DEPLOY_SSH_USER"
[ -n "$SSH_HOST" ] || missing="$missing NUVA_DEPLOY_SSH_HOST"
[ -n "$SSH_PORT" ] || missing="$missing NUVA_DEPLOY_SSH_PORT"
if [ -n "$missing" ]; then
  die "$E_CONFIG" "falta definir:$missing
Ponha as três variáveis NUVA_DEPLOY_SSH_* no .env.local desta máquina ($ENV_FILE) ou no ambiente.
Elas não vão para o servidor. Veja docs/ambiente-de-teste.md."
fi
[[ "$SSH_USER" =~ ^[A-Za-z_][A-Za-z0-9._-]*$ ]] || die "$E_CONFIG" 'NUVA_DEPLOY_SSH_USER inválido'
[[ "$SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] || die "$E_CONFIG" 'NUVA_DEPLOY_SSH_HOST inválido'
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || die "$E_CONFIG" 'NUVA_DEPLOY_SSH_PORT inválido'

# Só chave (BatchMode: nunca pede senha), sem agente nem porta encaminhados.
SSH_ARGS=(
  -o BatchMode=yes
  -o ForwardAgent=no
  -o ForwardX11=no
  -o ClearAllForwardings=yes
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -p "$SSH_PORT"
  "$SSH_USER@$SSH_HOST"
)

# --- etiqueta e arquivos ---------------------------------------------------------------------

cd "$ROOT"

if [ -z "$TAG" ]; then
  git fetch --quiet origin main 2>/dev/null ||
    say 'aviso: não consegui atualizar origin/main (git fetch); sigo com a referência local.' >&2
  head_sha="$(git rev-parse HEAD)"
  main_sha="$(git rev-parse main)"
  origin_sha="$(git rev-parse origin/main)"
  if [ "$head_sha" != "$main_sha" ] || [ "$main_sha" != "$origin_sha" ]; then
    die "$E_GIT" "sem etiqueta, o HEAD precisa ser a main local e estar igual a origin/main.
  HEAD        ${head_sha:0:7}
  main        ${main_sha:0:7}
  origin/main ${origin_sha:0:7}
Rode do checkout principal com a main atualizada e publicada, ou informe a etiqueta
(ex.: pnpm deploy:test sha-${origin_sha:0:7})."
  fi
  TAG="sha-${head_sha:0:7}"
fi
[[ "$TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "$E_USAGE" "etiqueta inválida: $TAG"

# Trava da lista de envio: só o que está no Git, sem alteração local, e nunca segredo, tarefa,
# rascunho ou código-fonte. A lista é fixa; a conferência protege contra uma edição descuidada.
FILES=()
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    .env | docker-compose.yml | */docker-compose.yml) ;;
    *) die "$E_USAGE" "arquivo fora do permitido na lista de envio: $file" ;;
  esac
  case "$file" in
    /* | *..* | *.env.local* | tasks/* | tmp/* | specs/* | *.ts | *.tsx | *.mjs | *.sql)
      die "$E_USAGE" "arquivo proibido na lista de envio: $file"
      ;;
  esac
  [ -f "$ROOT/$file" ] || die "$E_GIT" "arquivo de deploy ausente: $file"
  FILES+=("$file")
done <<EOF
$DEPLOY_FILES
EOF

git ls-files --error-unmatch -- "${FILES[@]}" >/dev/null 2>&1 ||
  die "$E_GIT" 'há arquivo de deploy fora do Git; só vai para o servidor o que está versionado.'
git diff --quiet HEAD -- "${FILES[@]}" ||
  die "$E_GIT" 'há arquivo Compose ou .env com alteração não commitada; commite ou desfaça antes.'

# Volume do banco que o compose enviado declara (sem interpolar: não precisa de segredo).
POSTGRES_VOLUME="$(bash "$ROOT/scripts/volume-migrate.sh" --print-name --no-interpolate -- \
  -p "$PROJECT" -f docker-compose.yml --env-file .env)" ||
  die "$E_COMPOSE" 'não consegui ler o volume do banco no docker compose config desta máquina.'
[[ "$POSTGRES_VOLUME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
  die "$E_COMPOSE" "nome de volume inválido no compose: $POSTGRES_VOLUME"

# --- imagens ---------------------------------------------------------------------------------

step "Imagens da etiqueta $TAG no Docker Hub"
missing_images=''
for image in $IMAGES; do
  ref="$IMAGE_PREFIX$image:$TAG"
  if reason="$(docker manifest inspect "$ref" 2>&1 >/dev/null)"; then
    say "  ok      $ref"
  else
    say "  FALTA   $ref (${reason##*$'\n'})"
    missing_images="$missing_images $image"
  fi
done
if [ -n "$missing_images" ]; then
  die "$E_IMAGE" "imagem não encontrada para a etiqueta $TAG:$missing_images
Nada foi feito no servidor. Confira o fluxo 'images' do CI para esse commit (docs/ci.md).
Para publicar só o que existe, de propósito, use --only (ex.: --only admin-api,classroom-api,worker);
os serviços fora da lista não são atualizados."
fi

# --- comandos remotos ------------------------------------------------------------------------

# Conferência no servidor: só leitura. Do .env.local sai apenas o valor de variáveis não
# secretas de uma lista fixa; da senha, só se existe.
preflight_script() {
  cat <<EOF
# nuva-deploy: conferência (só leitura)
DEPLOY_DIR='$DEPLOY_DIR'
PROJECT='$PROJECT'
POSTGRES_VOLUME='$POSTGRES_VOLUME'
LEGACY_POSTGRES_VOLUME='$LEGACY_POSTGRES_VOLUME'
NEEDS_DB='$BACKEND'
MIGRATE_VOLUME='$MIGRATE_VOLUME'
EOF
  cat <<'EOF'
set -u
[ -d "$DEPLOY_DIR" ] || exit 41
env_local="$DEPLOY_DIR/.env.local"
[ -f "$env_local" ] || exit 42
docker compose version >/dev/null 2>&1 || exit 43
has() { grep -q "^[[:space:]]*$1=" "$env_local"; }
val() {
  sed -n "s/^[[:space:]]*$1=//p" "$env_local" | tail -n 1 |
    sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
problems=0
problem() {
  echo "PROBLEMA: $1"
  problems=1
}
expect() { [ "$(val "$1")" = "$2" ] || problem "$1 precisa ser '$2'"; }
[ -n "$(val POSTGRES_PASSWORD)" ] || problem 'POSTGRES_PASSWORD precisa estar definida'
domain="$(val NUVA_DOMAIN)"
case "$domain" in
  '' | localhost) problem 'NUVA_DOMAIN precisa ser o domínio do ambiente de teste' ;;
esac
network="$(val TRAEFIK_NETWORK)"
[ -n "$network" ] || problem 'TRAEFIK_NETWORK precisa ser a rede do Traefik do servidor'
expect TRAEFIK_NETWORK_EXTERNAL true
expect NUVA_PUBLIC_SCHEME https
[ -n "$(val TRAEFIK_ENTRYPOINTS)" ] || problem 'TRAEFIK_ENTRYPOINTS precisa estar definida'
[ -n "$(val TRAEFIK_CERTRESOLVER)" ] || problem 'TRAEFIK_CERTRESOLVER precisa estar definida'
if ! has NUVA_PUBLIC_PORT || [ -n "$(val NUVA_PUBLIC_PORT)" ]; then
  problem 'NUVA_PUBLIC_PORT precisa existir e ficar vazia (NUVA_PUBLIC_PORT=)'
fi
for name in COMPOSE_PROFILES COMPOSE_FILE COMPOSE_PROJECT_NAME PORT; do
  if has "$name"; then problem "$name não pode estar no .env.local do servidor"; fi
done
[ "$problems" -eq 0 ] || exit 44
docker network inspect "$network" >/dev/null 2>&1 || {
  echo "PROBLEMA: a rede $network não existe no servidor"
  exit 45
}
volume_owner() {
  docker volume inspect "$1" --format '{{ index .Labels "com.docker.compose.project" }}' 2>/dev/null
}
if [ "$NEEDS_DB" = true ] && docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1; then
  owner="$(volume_owner "$POSTGRES_VOLUME")"
  if [ "$owner" != "$PROJECT" ]; then
    echo "PROBLEMA: o volume $POSTGRES_VOLUME já existe e é de outro projeto (${owner:-sem rótulo})"
    exit 46
  fi
elif [ "$NEEDS_DB" = true ] && [ "$POSTGRES_VOLUME" != "$LEGACY_POSTGRES_VOLUME" ] &&
  docker volume inspect "$LEGACY_POSTGRES_VOLUME" >/dev/null 2>&1 &&
  [ "$(volume_owner "$LEGACY_POSTGRES_VOLUME")" = "$PROJECT" ]; then
  # Volume antigo do projeto e nenhum novo: subir sem copiar começaria com o banco vazio.
  if [ "$MIGRATE_VOLUME" != true ]; then
    echo "PROBLEMA: é preciso copiar $LEGACY_POSTGRES_VOLUME para $POSTGRES_VOLUME"
    exit 48
  fi
  echo "MIGRAR=$LEGACY_POSTGRES_VOLUME"
fi
admin_host="$(val NUVA_ADMIN_HOST)"
classroom_host="$(val NUVA_CLASSROOM_HOST)"
echo "ADMIN_HOST=${admin_host:-edu-admin.$domain}"
echo "CLASSROOM_HOST=${classroom_host:-classroom.$domain}"
echo "REDE=$network"
echo "DOCKER=$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
echo "COMPOSE=$(docker compose version --short 2>/dev/null)"
EOF
}

unpack_command() {
  printf 'tar -xf - --no-same-owner -C %s' "$DEPLOY_DIR"
}

# Publicação: só `docker compose -p nuva-edu`, com a lista explícita de serviços. Sem perfis,
# sem docker-compose.dev.yml (o Postgres não publica porta) e sem build.
deploy_script() {
  local LOG_SERVICES="\$SERVICES"
  if $BACKEND; then LOG_SERVICES="migrate \$SERVICES"; fi
  cat <<EOF
# nuva-deploy: publicação
DEPLOY_DIR='$DEPLOY_DIR'
SERVICES='$SERVICES'
export NUVA_IMAGE_TAG='$TAG'
EOF
  cat <<EOF
set -euo pipefail
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME
cd "\$DEPLOY_DIR"
compose() {
  docker compose -p $PROJECT -f docker-compose.yml --env-file .env --env-file .env.local "\$@" </dev/null
}
# shellcheck disable=SC2086
compose pull --quiet --include-deps \$SERVICES
EOF
  if $MIGRATE_VOLUME && $BACKEND; then
    # O scripts/volume-migrate.sh vai no próprio fluxo da conexão (não é gravado no servidor):
    # só copia nas condições da spec e nunca apaga o volume antigo.
    printf "IFS= read -r -d '' VOLUME_MIGRATE <<'NUVA_VOLUME_MIGRATE_EOF' || true\n"
    cat "$ROOT/scripts/volume-migrate.sh"
    printf 'NUVA_VOLUME_MIGRATE_EOF\n'
    cat <<EOF
if ! bash -c "\$VOLUME_MIGRATE" volume-migrate --from '$LEGACY_POSTGRES_VOLUME' --project $PROJECT -- \\
  -p $PROJECT -f docker-compose.yml --env-file .env --env-file .env.local </dev/null; then
  exit 49
fi
EOF
  fi
  cat <<EOF
# shellcheck disable=SC2086
if ! compose up -d --no-build --wait --wait-timeout $WAIT_SECONDS \$SERVICES; then
  compose ps --all || true
  # shellcheck disable=SC2086
  compose logs --no-color --tail 40 $LOG_SERVICES || true
  exit 47
fi
compose ps --all --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
EOF
}

ssh_display="ssh ${SSH_ARGS[*]}"

if $DRY_RUN; then
  step 'Simulação (--dry-run): nenhuma conexão com o servidor foi feita'
  say "Servidor: $SSH_USER@$SSH_HOST porta $SSH_PORT, pasta $DEPLOY_DIR"
  say "Etiqueta: $TAG"
  say "Serviços: $SERVICES"
  say "Volume do banco: $POSTGRES_VOLUME"
  if $MIGRATE_VOLUME; then
    say "Com --migrate-volume: copia $LEGACY_POSTGRES_VOLUME para $POSTGRES_VOLUME, se necessário."
  fi
  if [ "$SERVICES" != "$ALL_SERVICES" ]; then
    say 'Deploy parcial: os serviços fora da lista não são criados nem atualizados.'
  fi
  step "1. Conferência, só leitura: $ssh_display bash -s"
  preflight_script
  step "2. Arquivos enviados (tar pela mesma conexão): $ssh_display $(unpack_command)"
  printf '  %s\n' "${FILES[@]}"
  say "  (o .env.local do servidor não é enviado, lido por inteiro nem sobrescrito)"
  step "3. Publicação: $ssh_display bash -s"
  deploy_script
  step '4. Conferência pública, desta máquina (curl, certificado validado)'
  if has_service admin-api; then say '  https://<NUVA_ADMIN_HOST do servidor>/healthz'; fi
  if has_service classroom-api; then say '  https://<NUVA_CLASSROOM_HOST do servidor>/healthz'; fi
  if has_service admin; then say '  https://<NUVA_ADMIN_HOST do servidor>/config.json'; fi
  if has_service classroom; then say '  https://<NUVA_CLASSROOM_HOST do servidor>/config.json'; fi
  exit 0
fi

# --- execução --------------------------------------------------------------------------------

remote_env_help() {
  cat >&2 <<EOF

Crie no servidor, uma única vez e à mão, $DEPLOY_DIR/.env.local (modo 600). O script nunca
cria nem altera esse arquivo. Conteúdo esperado:

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

Sem NUVA_DEPLOY_SSH_*, COMPOSE_* nem PORT. Veja docs/ambiente-de-teste.md.
EOF
}

step "Conferência no servidor ($SSH_USER@$SSH_HOST:$SSH_PORT, só leitura)"
set +e
preflight_output="$(preflight_script | ssh "${SSH_ARGS[@]}" bash -s)"
preflight_status=$?
set -e
printf '%s\n' "$preflight_output" | grep '^PROBLEMA: ' >&2 || true
case "$preflight_status" in
  0) ;;
  41)
    remote_env_help
    die "$E_REMOTE_ENV" "a pasta $DEPLOY_DIR não existe no servidor. Nada foi criado."
    ;;
  42)
    remote_env_help
    die "$E_REMOTE_ENV" "falta $DEPLOY_DIR/.env.local no servidor. Nada foi criado nem enviado."
    ;;
  43) die "$E_SSH" 'o servidor não tem docker compose disponível para este usuário.' ;;
  44)
    remote_env_help
    die "$E_REMOTE_INVALID" "o .env.local do servidor não serve ao ambiente de teste. Nada foi enviado."
    ;;
  45) die "$E_REMOTE_CONFLICT" 'a rede do Traefik não existe no servidor. Nada foi enviado.' ;;
  46)
    die "$E_REMOTE_CONFLICT" "o volume $POSTGRES_VOLUME do servidor pertence a outro projeto.
Nada foi enviado: subir o banco usaria os dados de terceiros. Leve ao humano."
    ;;
  48)
    die "$E_MIGRATION" "o servidor tem o volume antigo $LEGACY_POSTGRES_VOLUME do projeto e ainda não
tem o $POSTGRES_VOLUME. Subir assim começaria com o banco vazio. Nada foi enviado.
Para copiar (decisão do humano; o postgres do projeto fica parado durante a cópia e o volume
antigo não é apagado), rode de novo com a opção:
  pnpm deploy:test ${TAG} --migrate-volume
Procedimento e remoção manual do volume antigo: docs/ambiente-de-teste.md."
    ;;
  *) die "$E_SSH" "falha na conexão ou na conferência (ssh saiu com $preflight_status). Nada foi enviado." ;;
esac

remote_value() {
  printf '%s\n' "$preflight_output" | sed -n "s/^$1=//p" | tail -n 1
}
ADMIN_HOST="$(remote_value ADMIN_HOST)"
CLASSROOM_HOST="$(remote_value CLASSROOM_HOST)"
host_pattern='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
[[ "$ADMIN_HOST" =~ $host_pattern ]] || die "$E_REMOTE_INVALID" 'host do admin inválido no servidor'
[[ "$CLASSROOM_HOST" =~ $host_pattern ]] || die "$E_REMOTE_INVALID" 'host do classroom inválido no servidor'
if [ -n "$(remote_value MIGRAR)" ]; then
  say "  migração de volume: $LEGACY_POSTGRES_VOLUME para $POSTGRES_VOLUME (--migrate-volume)"
fi
say "  Docker $(remote_value DOCKER), Compose $(remote_value COMPOSE), rede $(remote_value REDE)"
say "  hosts: $ADMIN_HOST e $CLASSROOM_HOST"

step "Envio dos arquivos Compose e do .env para $DEPLOY_DIR"
tar_args=(-cf -)
if tar --version 2>/dev/null | grep -qi bsdtar; then
  tar_args+=(--no-mac-metadata --no-xattrs)
fi
# shellcheck disable=SC2029  # a pasta é expandida aqui de propósito e já foi validada
COPYFILE_DISABLE=1 tar "${tar_args[@]}" -C "$ROOT" "${FILES[@]}" |
  ssh "${SSH_ARGS[@]}" "$(unpack_command)" ||
  die "$E_SSH" 'falha ao enviar os arquivos.'
printf '  %s\n' "${FILES[@]}"

step "Publicação: pull e up -d --wait de: $SERVICES"
set +e
deploy_script | ssh "${SSH_ARGS[@]}" bash -s
deploy_status=$?
set -e
if [ "$deploy_status" -eq 49 ]; then
  die "$E_DEPLOY" "a migração do volume $LEGACY_POSTGRES_VOLUME para $POSTGRES_VOLUME falhou no servidor.
O volume antigo não foi alterado e o postgres do projeto pode ter ficado parado. Leve ao humano."
fi
if [ "$deploy_status" -ne 0 ]; then
  die "$E_DEPLOY" "a publicação falhou no servidor (saída $deploy_status). Os logs estão acima.
Não há volta automática: corrija e rode de novo, ou publique a etiqueta anterior."
fi

step 'Conferência pública (HTTPS, certificado validado)'
health_failed=''
check_url() {
  if curl --fail --silent --show-error --output /dev/null --max-time 10 \
    --retry 8 --retry-delay 5 --retry-all-errors "$1"; then
    say "  ok      $1"
  else
    say "  FALHOU  $1"
    health_failed="$health_failed $1"
  fi
}
if has_service admin-api; then check_url "https://$ADMIN_HOST/healthz"; fi
if has_service classroom-api; then check_url "https://$CLASSROOM_HOST/healthz"; fi
if has_service admin; then check_url "https://$ADMIN_HOST/config.json"; fi
if has_service classroom; then check_url "https://$CLASSROOM_HOST/config.json"; fi
if [ -n "$health_failed" ]; then
  die "$E_HEALTH" "os serviços subiram, mas a URL pública não respondeu:$health_failed
Confira o DNS, o certificado e os rótulos do Traefik (docs/ambiente-de-teste.md)."
fi

step 'Resumo'
say "  etiqueta publicada: $TAG"
say "  serviços: $SERVICES"
if [ "$SERVICES" != "$ALL_SERVICES" ]; then
  say '  deploy parcial: os serviços fora da lista não foram atualizados.'
fi
say "  https://$ADMIN_HOST"
say "  https://$CLASSROOM_HOST"
