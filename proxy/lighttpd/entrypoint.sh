#!/bin/sh
# Entrada dos contêineres dos sites (spec 031, "Configuração de execução dos sites").
#
# 1. Gera o config.json na subida: qual site é este e o endereço público dos dois, para a mesma
#    imagem servir a qualquer instalação. Moeda, idioma e versão vêm do /api/v1/meta, não daqui.
#    O arquivo é público: nunca recebe segredo. A pasta de saída é /run/nuva (tmpfs gravável;
#    a raiz do site tem um atalho para lá); NUVA_CONFIG_DIR a troca nos testes.
# 2. Troca este processo pelo comando recebido (`exec`): o lighttpd fica como PID 1 e recebe os
#    sinais do Docker direto. Sem comando, só gera o arquivo.
set -eu

fail() {
  echo "nuva-config: $1" >&2
  exit 1
}

# Só letras, números, ponto e hífen: o valor vai para dentro de um JSON sem escape.
check() {
  name="$1"
  value="$2"
  pattern="$3"
  # O `\n` no fim dá ao grep uma linha mesmo com o valor vazio (porta vazia é válida); valor com
  # quebra de linha é recusado antes, porque o grep confere linha a linha.
  case "$value" in
    *"
"*) fail "$name inválida: tem quebra de linha" ;;
  esac
  if ! printf '%s\n' "$value" | grep -Eq "$pattern"; then
    fail "$name inválida: \"$value\""
  fi
}

app="${NUVA_APP:?defina NUVA_APP (admin ou classroom)}"
domain="${NUVA_DOMAIN:-localhost}"
admin_host="${NUVA_ADMIN_HOST:-edu-admin.$domain}"
classroom_host="${NUVA_CLASSROOM_HOST:-classroom.$domain}"
scheme="${NUVA_PUBLIC_SCHEME:-http}"
port="${NUVA_PUBLIC_PORT-8080}"
out_dir="${NUVA_CONFIG_DIR:-/run/nuva}"

check NUVA_APP "$app" '^(admin|classroom)$'
check NUVA_ADMIN_HOST "$admin_host" '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
check NUVA_CLASSROOM_HOST "$classroom_host" '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
check NUVA_PUBLIC_SCHEME "$scheme" '^https?$'
check NUVA_PUBLIC_PORT "$port" '^[0-9]{0,5}$'

# Mesma regra de packages/core: porta vazia ou padrão do esquema não aparece na URL.
suffix=""
if [ -n "$port" ]; then
  if [ "$scheme" = "http" ] && [ "$port" != "80" ]; then suffix=":$port"; fi
  if [ "$scheme" = "https" ] && [ "$port" != "443" ]; then suffix=":$port"; fi
fi

mkdir -p "$out_dir"
cat > "$out_dir/config.json" <<JSON
{
  "app": "$app",
  "adminUrl": "$scheme://$admin_host$suffix",
  "classroomUrl": "$scheme://$classroom_host$suffix"
}
JSON
echo "nuva-config: $out_dir/config.json gerado para o site $app"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
