#!/usr/bin/env bash
# Migração do volume do banco para o nome com o prefixo do projeto (spec 031, "Volumes").
#
#   bash scripts/volume-migrate.sh [opções] -- <argumentos globais do docker compose>
#
# Exemplo (o que o `pnpm dev:up` faz):
#   bash scripts/volume-migrate.sh -- --env-file .env --env-file .env.local
#
# Os arquivos de ambiente e de Compose vêm só do que estiver depois de `--`: o script não carrega
# o `.env.local` por conta própria (no servidor de testes, o `deploy:test` passa os dele). Sem
# nada depois de `--`, o Compose lê só o `.env`, e o `docker compose config` falha pelos segredos
# exigidos (`${VAR:?}`). Para conferir o ambiente local:
#   bash scripts/volume-migrate.sh --check -- --env-file .env --env-file .env.local
#
# Copia o volume antigo (`postgres-data`) para o volume que o Compose declara para
# /var/lib/postgresql do serviço `postgres` só quando, ao mesmo tempo:
#   1. o Compose declara um nome diferente do antigo;
#   2. o volume declarado ainda não existe;
#   3. o antigo existe com o rótulo com.docker.compose.project=<projeto> (padrão: nuva-edu), e o
#      projeto do Compose é esse mesmo.
# Em qualquer outro caso não faz nada. Quando copia: para só o serviço `postgres` do projeto
# (`docker compose stop postgres`), confere que nenhum contêiner rodando usa o volume antigo,
# deixa o Compose criar o volume novo (com os rótulos dele) num `docker compose run --rm` do
# próprio `postgres` e copia com `cp -a`, conferindo com `diff -r`. O volume antigo nunca é
# apagado nem alterado (é montado só para leitura). Se a cópia falhar, só o volume novo, criado
# nesta execução, é removido. Rodar de novo não faz nada.
#
# Opções:
#   --check           só diz se a migração é necessária (sai com 3) ou não (sai com 0)
#   --print-name      imprime o nome do volume declarado pelo Compose e sai
#   --no-interpolate  lê o `docker compose config` sem interpolar (não exige os segredos)
#   --from <volume>   volume antigo (padrão: postgres-data)
#   --project <nome>  projeto Compose esperado (padrão: nuva-edu)
#
# Saída: 0 nada a fazer ou migrado; 1 falha; 2 uso; 3 migração necessária (--check);
# 4 volume antigo em uso por outro contêiner; 5 projeto do Compose diferente do esperado.
#
# Compatível com o bash 3.2 do macOS.
set -euo pipefail

readonly SERVICE='postgres'
readonly TARGET='/var/lib/postgresql'
readonly SOURCE_MOUNT='/nuva-volume-origem'

FROM='postgres-data'
PROJECT='nuva-edu'
CHECK=false
PRINT_NAME=false
NO_INTERPOLATE=false

say() { printf 'volume-migrate: %s\n' "$*"; }
die() {
  local code="$1"
  shift
  printf 'volume-migrate: %s\n' "$*" >&2
  exit "$code"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=true ;;
    --print-name) PRINT_NAME=true ;;
    --no-interpolate) NO_INTERPOLATE=true ;;
    --from)
      [ $# -ge 2 ] || die 2 '--from precisa do nome do volume'
      FROM="$2"
      shift
      ;;
    --project)
      [ $# -ge 2 ] || die 2 '--project precisa do nome do projeto'
      PROJECT="$2"
      shift
      ;;
    --)
      shift
      break
      ;;
    *) die 2 "opção desconhecida: $1 (os argumentos do docker compose vêm depois de --)" ;;
  esac
  shift
done

name_pattern='^[A-Za-z0-9][A-Za-z0-9_.-]*$'
[[ "$FROM" =~ $name_pattern ]] || die 2 "nome de volume inválido: $FROM"
[[ "$PROJECT" =~ $name_pattern ]] || die 2 "nome de projeto inválido: $PROJECT"

compose() { docker compose "$@" </dev/null; }

# --- o que o Compose declara ---------------------------------------------------------------

config_args=(config)
if $NO_INTERPOLATE; then config_args+=(--no-interpolate); fi
config_failed() {
  local hint='Os segredos vêm dos --env-file depois de --; no ambiente local:
  bash scripts/volume-migrate.sh [opções] -- --env-file .env --env-file .env.local'
  if [ "$1" -eq 0 ]; then
    hint="Nada foi passado depois de --, então o Compose leu só o .env (o .env.local não é carregado).
$hint"
  fi
  die 1 "o docker compose config falhou (veja acima).
$hint"
}
config="$(compose "$@" "${config_args[@]}")" || config_failed $#

# Lê a forma normalizada do `docker compose config` (chaves em ordem, dois espaços por nível):
# o projeto (`name:`), a origem do volume montado em $TARGET no serviço $SERVICE e o `name:`
# desse volume na seção `volumes:` do topo.
parse_config() {
  awk -v svc="$SERVICE" -v target="$TARGET" '
    function unquote(v) {
      sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
      return v
    }
    function flush() {
      if (in_item && tgt == target && key == "") key = src
      in_item = 0; src = ""; tgt = ""
    }
    /^[^ ]/ {
      flush(); in_mounts = 0
      top = $0; sub(/:.*/, "", top)
      if (top == "name") { v = $0; sub(/^name:/, "", v); project = unquote(v) }
      next
    }
    top == "services" && /^  [^ ]/ {
      flush(); in_mounts = 0
      current = $0; sub(/^  /, "", current); sub(/:.*/, "", current)
      next
    }
    top == "services" && current == svc && /^    [^ ]/ {
      flush(); in_mounts = ($0 ~ /^    volumes:/)
      next
    }
    top == "services" && in_mounts && /^      - / { flush(); in_item = 1 }
    top == "services" && in_mounts && in_item {
      line = $0; sub(/^ +(- )?/, "", line)
      if (line ~ /^source:/) { sub(/^source:/, "", line); src = unquote(line) }
      else if (line ~ /^target:/) { sub(/^target:/, "", line); tgt = unquote(line) }
      next
    }
    top == "volumes" && /^  [^ ]/ {
      volume = $0; sub(/^  /, "", volume); sub(/:.*/, "", volume)
      next
    }
    top == "volumes" && /^    name:/ {
      v = $0; sub(/^    name:/, "", v); names[volume] = unquote(v)
      next
    }
    END {
      flush()
      print "PROJECT=" project
      print "NAME=" (key == "" ? "" : (key in names ? names[key] : project "_" key))
    }
  '
}

parsed="$(printf '%s\n' "$config" | parse_config)"
compose_project="$(printf '%s\n' "$parsed" | sed -n 's/^PROJECT=//p')"
TO="$(printf '%s\n' "$parsed" | sed -n 's/^NAME=//p')"
[ -n "$TO" ] || die 1 "o Compose não declara volume nomeado em $TARGET do serviço $SERVICE."
[[ "$TO" =~ $name_pattern ]] || die 1 "nome de volume declarado inválido: $TO"

if $PRINT_NAME; then
  printf '%s\n' "$TO"
  exit 0
fi

[ "$compose_project" = "$PROJECT" ] ||
  die 5 "o projeto do Compose é '${compose_project:-?}', não '$PROJECT'. Nada foi feito."

# --- as condições --------------------------------------------------------------------------

volume_exists() { docker volume inspect "$1" >/dev/null 2>&1 </dev/null; }
volume_project() {
  docker volume inspect "$1" --format '{{ index .Labels "com.docker.compose.project" }}' \
    2>/dev/null </dev/null || true
}

if [ "$TO" = "$FROM" ]; then
  say "nada a fazer: o Compose ainda declara o volume $FROM."
  exit 0
fi
if volume_exists "$TO"; then
  say "nada a fazer: o volume $TO já existe (não é sobrescrito)."
  exit 0
fi
if ! volume_exists "$FROM"; then
  say "nada a fazer: não há volume $FROM; o $TO nasce vazio na subida."
  exit 0
fi
owner="$(volume_project "$FROM")"
if [ "$owner" != "$PROJECT" ]; then
  say "nada a fazer: o volume $FROM é de outro projeto (${owner:-sem rótulo}) e fica de fora."
  exit 0
fi

if $CHECK; then
  say "migração necessária: copiar $FROM para $TO."
  exit 3
fi

# --- a cópia -------------------------------------------------------------------------------

say "copiando $FROM para $TO (o $FROM fica como está)."
say "parando o serviço $SERVICE do projeto $PROJECT para a cópia."
compose "$@" stop "$SERVICE" || die 1 "não consegui parar o serviço $SERVICE. Nada foi copiado."

in_use="$(docker ps -q --filter "volume=$FROM" </dev/null)" ||
  die 1 'não consegui listar os contêineres em execução. Nada foi copiado.'
if [ -n "$in_use" ]; then
  die 4 "o volume $FROM ainda está em uso por contêiner em execução ($(printf '%s' "$in_use" | tr '\n' ' '))
Pare-o e rode de novo. Nada foi copiado."
fi
volume_exists "$TO" && die 1 "o volume $TO apareceu durante a migração. Nada foi copiado."

# O `run` cria o volume declarado (com os rótulos do Compose) e o monta em $TARGET; o antigo
# entra só para leitura. Roda com o usuário, a imagem e as restrições do próprio serviço.
copy="cp -a $SOURCE_MOUNT/. $TARGET/ && diff -r $SOURCE_MOUNT $TARGET"
if ! compose "$@" run --rm --no-deps -T --entrypoint sh \
  -v "$FROM:$SOURCE_MOUNT:ro" "$SERVICE" -c "$copy"; then
  if volume_exists "$TO"; then
    docker volume rm "$TO" >/dev/null </dev/null ||
      say "não consegui remover o $TO incompleto: apague-o à mão (docker volume rm $TO)."
  fi
  die 1 "a cópia falhou; o volume $FROM não foi alterado. O $SERVICE ficou parado."
fi

new_owner="$(volume_project "$TO")"
[ "$new_owner" = "$PROJECT" ] ||
  die 1 "o volume $TO foi criado sem o rótulo do projeto $PROJECT (${new_owner:-sem rótulo})."

say "pronto: $TO tem a cópia de $FROM. O $SERVICE volta na próxima subida."
say "depois de conferir o banco, apague o antigo à mão: docker volume rm $FROM"
