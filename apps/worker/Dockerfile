# syntax=docker/dockerfile:1
# Imagem do worker (spec 031). Contexto de build: a raiz do repositório.
#   docker build -f apps/worker/Dockerfile -t tmsoftbrasil/nuva-edu-worker:local .
#
# O serviço roda TypeScript direto no Node 26 (`node src/main.ts`), sem compilação. Por isso a
# imagem mantém a árvore do workspace: o Node só executa `.ts` fora de node_modules, e os pacotes
# internos chegam por links simbólicos para packages/ e database/.

ARG NODE_IMAGE=node:26-slim

# 1. deps: só os manifestos, para o cache das dependências sobreviver a mudanças de código.
FROM ${NODE_IMAGE} AS deps
ENV CI=true
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Mesma versão do pnpm fixada em "packageManager".
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager")"
COPY database/postgres/package.json database/postgres/
COPY packages/core/package.json packages/core/
COPY packages/api-kit/package.json packages/api-kit/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=nuva-edu-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --store-dir /pnpm/store \
      --filter "@nuva-edu/worker..."

# 2. build: junta o código às dependências. Não há o que compilar; aqui só se carimba a versão.
#    database/postgres leva a pasta migrations/, lida pelo /readyz.
FROM deps AS build
COPY database/postgres/src database/postgres/src
COPY database/postgres/migrations database/postgres/migrations
COPY packages/core/src packages/core/src
# Do api-kit o worker carrega só as entradas `/metrics` e `/health`: não sobe o Fastify.
COPY packages/api-kit/src packages/api-kit/src
COPY apps/worker/src apps/worker/src
# Versão do serviço: a do package.json, trocada pela da release quando o CI passa NUVA_VERSION
# (sem o "v" da tag).
ARG NUVA_VERSION=
RUN if [ -n "${NUVA_VERSION}" ]; then \
      cd apps/worker && npm pkg set "version=${NUVA_VERSION}"; \
    fi

# 3. runtime: sem pnpm, sem npm, sem cache de pacotes e sem usuário privilegiado.
FROM ${NODE_IMAGE} AS runtime
# O npm (e o corepack, quando a base o traz) não é usado em execução: o serviço, o healthcheck e
# os comandos da imagem chamam `node` direto. Sai da imagem com as dependências dele, que é
# onde o Trivy acusa as vulnerabilidades da base.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# PDF do certificado (ADR 0026; spec 031, "Dockerfiles"): o Chromium headless shell na versão do
# `playwright-core` do lockfile, com as bibliotecas de sistema dele. O `playwright-core` instalado
# vem do estágio `deps` por montagem, sem ficar na camada: a camada só muda com o lockfile, não
# com o código. A CLI roda com `node` (a imagem não tem npm). O ffmpeg que vem junto só grava
# vídeo de teste e sai (é LGPL e não é usado). Fora o que o Playwright instala,
# entram a fonte Inter (OFL-1.1; licença em /usr/share/doc/fonts-inter-variable/copyright) e as
# correções dos pacotes da base (`apt-get upgrade`), para o Trivy não acusar o que já tem correção.
# A lista do `apt` sai no mesmo passo. Licenças do Chromium: docs/imagem-do-worker.md.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Inter é a fonte padrão: as famílias genéricas e as que o Chromium usa como padrão no Linux
# (Times New Roman, Arial) resolvem para ela; "Inter" no CSS também. Outras fontes, só embutidas
# no template por `data:`, e as que o Playwright instala servem de reserva (acentos, CJK, emoji).
COPY <<'EOF' /etc/fonts/local.conf
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <alias binding="same">
    <family>Inter</family>
    <prefer><family>Inter Variable</family></prefer>
  </alias>
  <alias binding="same">
    <family>Times New Roman</family>
    <prefer><family>Inter Variable</family></prefer>
  </alias>
  <alias binding="same">
    <family>Arial</family>
    <prefer><family>Inter Variable</family></prefer>
  </alias>
  <alias binding="same">
    <family>serif</family>
    <prefer><family>Inter Variable</family></prefer>
  </alias>
  <alias binding="same">
    <family>sans-serif</family>
    <prefer><family>Inter Variable</family></prefer>
  </alias>
  <alias binding="same">
    <family>system-ui</family>
    <prefer><family>Inter Variable</family></prefer>
  </alias>
</fontconfig>
EOF
RUN --mount=type=bind,from=deps,source=/app,target=/deps \
    export DEBIAN_FRONTEND=noninteractive \
    && node /deps/apps/worker/node_modules/playwright-core/cli.js \
         install --with-deps --only-shell chromium \
    && rm -rf /ms-playwright/ffmpeg-* \
    && apt-get install -y --no-install-recommends fonts-inter-variable \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/log/apt /var/log/dpkg.log /tmp/* \
    && fc-cache -f \
    && fc-match -f '%{family[0]}\n' sans-serif | grep -qx 'Inter Variable'

# PORT não é definida: dentro do contêiner a porta é sempre a padrão, 3000 (spec 031).
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
