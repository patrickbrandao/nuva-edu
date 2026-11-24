#!/bin/sh
# Gera /run/nuva/config.json na subida do contêiner dos sites (spec 031): nomes de host, moeda
# e idioma chegam em tempo de execução, para a mesma imagem servir a qualquer instalação.
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
  if ! printf '%s' "$value" | grep -Eq "$pattern"; then
    fail "$name inválida: \"$value\""
  fi
}

app="${NUVA_APP:?defina NUVA_APP (admin ou classroom)}"
domain="${NUVA_DOMAIN:-localhost}"
admin_host="${NUVA_ADMIN_HOST:-edu-admin.$domain}"
classroom_host="${NUVA_CLASSROOM_HOST:-classroom.$domain}"
scheme="${NUVA_PUBLIC_SCHEME:-http}"
port="${NUVA_PUBLIC_PORT-8080}"
currency="${NUVA_CURRENCY:-BRL}"
locale="${NUVA_LOCALE:-pt-BR}"

check NUVA_APP "$app" '^(admin|classroom)$'
check NUVA_ADMIN_HOST "$admin_host" '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
check NUVA_CLASSROOM_HOST "$classroom_host" '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
check NUVA_PUBLIC_SCHEME "$scheme" '^https?$'
check NUVA_PUBLIC_PORT "$port" '^[0-9]{0,5}$'
check NUVA_CURRENCY "$currency" '^[A-Z]{3}$'
check NUVA_LOCALE "$locale" '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'

# Mesma regra de packages/core: porta vazia ou padrão do esquema não aparece na URL.
suffix=""
if [ -n "$port" ]; then
  if [ "$scheme" = "http" ] && [ "$port" != "80" ]; then suffix=":$port"; fi
  if [ "$scheme" = "https" ] && [ "$port" != "443" ]; then suffix=":$port"; fi
fi

mkdir -p /run/nuva
cat > /run/nuva/config.json <<JSON
{
  "app": "$app",
  "adminHost": "$admin_host",
  "classroomHost": "$classroom_host",
  "adminUrl": "$scheme://$admin_host$suffix",
  "classroomUrl": "$scheme://$classroom_host$suffix",
  "currency": "$currency",
  "locale": "$locale"
}
JSON
echo "nuva-config: /run/nuva/config.json gerado para o site $app"
