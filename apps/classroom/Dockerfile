# syntax=docker/dockerfile:1
# Imagem do site classroom (spec 031): arquivos estáticos servidos por lighttpd sem privilégios.
# Contexto de build: a raiz do repositório.
#   docker build -f apps/classroom/Dockerfile -t tmsoftbrasil/nuva-edu-classroom:local .

ARG NODE_IMAGE=node:26-slim
ARG ALPINE_IMAGE=alpine:3.24

# 1. deps: só os manifestos, para o cache das dependências sobreviver a mudanças de código.
FROM ${NODE_IMAGE} AS deps
ENV CI=true
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Mesma versão do pnpm fixada em "packageManager".
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager")"
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY apps/classroom/package.json apps/classroom/
RUN --mount=type=cache,id=nuva-edu-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store \
      --filter "@nuva-edu/classroom..."

# 2. build: gera apps/classroom/dist com o Vite.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ui packages/ui
COPY packages/api-client packages/api-client
COPY apps/classroom apps/classroom
COPY proxy/lighttpd/csp.mjs proxy/lighttpd/csp.mjs
# A política de segurança de conteúdo sai do index.html gerado: o hash do script inline do tema
# acompanha o que a imagem realmente serve.
RUN pnpm --filter "@nuva-edu/classroom" build \
    && node proxy/lighttpd/csp.mjs classroom apps/classroom/dist/index.html > /app/nuva-csp.conf

# 3. runtime: Alpine com o lighttpd do próprio Alpine e o resultado do build. O /config.json
#    (`app`, `adminUrl` e `classroomUrl`) é gerado na subida do contêiner
#    (proxy/lighttpd/entrypoint.sh); a mesma imagem serve a qualquer instalação.
FROM ${ALPINE_IMAGE} AS runtime
# Correções do Alpine publicadas depois da imagem base.
RUN apk upgrade --no-cache
# Usuário sem privilégio com UID e GID fixos (101), criado antes do pacote para o número não
# depender da ordem de instalação; é o dono do tmpfs /run nos composes. O lighttpd já sobe como
# ele, sem trocar de usuário. Os exemplos de configuração do pacote não são usados.
RUN addgroup -S -g 101 nuva \
    && adduser -S -D -H -u 101 -G nuva -h /nonexistent -s /sbin/nologin nuva \
    && apk add --no-cache lighttpd \
    && rm -rf /etc/lighttpd/* /var/www/localhost /var/log/lighttpd /etc/logrotate.d/lighttpd
COPY proxy/lighttpd/lighttpd.conf /etc/lighttpd/lighttpd.conf
COPY --chmod=0755 proxy/lighttpd/entrypoint.sh /usr/local/bin/nuva-entrypoint.sh
COPY --from=build /app/nuva-csp.conf /etc/lighttpd/nuva-csp.conf
COPY --from=build /app/apps/classroom/dist /srv/nuva/site
# O atalho só aponta para um arquivo depois da subida: /run é tmpfs.
RUN ln -s /run/nuva/config.json /srv/nuva/site/config.json \
    && lighttpd -tt -f /etc/lighttpd/lighttpd.conf
ENV NUVA_APP=classroom
USER 101:101
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nuva-entrypoint.sh"]
CMD ["lighttpd", "-D", "-f", "/etc/lighttpd/lighttpd.conf"]
