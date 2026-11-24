# syntax=docker/dockerfile:1
# Imagem do site classroom (spec 031): arquivos estáticos servidos por Nginx sem privilégios.
# Contexto de build: a raiz do repositório.
#   docker build -f apps/classroom/Dockerfile -t tmsoftbrasil/nuva-edu-classroom:local .

ARG NODE_IMAGE=node:26-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:stable-alpine

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
COPY proxy/nginx/csp.mjs proxy/nginx/csp.mjs
# A política de segurança de conteúdo sai do index.html gerado: o hash do script inline do tema
# acompanha o que a imagem realmente serve.
RUN pnpm --filter "@nuva-edu/classroom" build \
    && node proxy/nginx/csp.mjs apps/classroom/dist/index.html > /app/nuva-csp.conf

# 3. runtime: só o resultado do build. Nomes de host e moeda chegam por /config.json, gerado na
#    subida do contêiner (proxy/nginx/40-nuva-config.sh); a mesma imagem serve a qualquer
#    instalação.
FROM ${NGINX_IMAGE} AS runtime
USER root
RUN rm -f /etc/nginx/conf.d/default.conf /docker-entrypoint.d/*
COPY proxy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 proxy/nginx/40-nuva-config.sh /docker-entrypoint.d/40-nuva-config.sh
COPY --from=build /app/nuva-csp.conf /etc/nginx/nuva-csp.conf
COPY --from=build /app/apps/classroom/dist /usr/share/nginx/html
ENV NUVA_APP=classroom
USER 101
EXPOSE 8080
