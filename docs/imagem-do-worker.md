# Imagem do worker: Chromium, Inter, tamanho, Trivy e licenças

Derivado da spec 031 ("Dockerfiles" e "Serviços") e da ADR 0026. Em caso de divergência, valem
as specs.

O worker gera o PDF do certificado com o Chromium headless shell, controlado pelo
`playwright-core` (ADR 0026). Por isso a imagem `tmsoftbrasil/nuva-edu-worker` leva, além do
Node, o navegador, as bibliotecas de sistema dele e a fonte Inter.

## O que o estágio `runtime` instala

Em `apps/worker/Dockerfile`, como `root`, antes do `USER node`, num único `RUN`:

1. `node .../playwright-core/cli.js install --with-deps --only-shell chromium`, com o
   `playwright-core` do estágio `deps` montado só durante o passo (não fica na camada). A versão
   é a do lockfile, a mesma do `@playwright/test` do e2e. A camada só muda quando muda o
   lockfile, não quando muda o código. O `--with-deps` instala pelo `apt` as bibliotecas do
   navegador (`libnss3`, `libgbm1` e a Mesa, `libx11`...) e as fontes de reserva do Playwright
   (Liberation, Noto Color Emoji, WenQuanYi Zen Hei, IPA Gothic, FreeFont, Unifont), além do
   `xvfb`.
2. O navegador fica em `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, variável que vale também em
   execução: é ali que o `chromium.launch()` do worker procura o executável, como nas máquinas
   de desenvolvimento e no CI, que usam o cache padrão do Playwright (`pnpm browsers:worker`).
3. O ffmpeg que o Playwright baixa junto (só grava vídeo de teste, LGPL-2.1) é apagado.
4. `fonts-inter-variable` do Debian: Inter 4.1, família `Inter Variable`.
5. `apt-get upgrade`: as correções de segurança da base entram a cada build, como o
   `apk upgrade` dos sites. Sem ele, a imagem antiga já falhava no Trivy (`libzstd1`, abaixo).
6. A lista e o cache do `apt` são apagados; `fc-cache -f` grava o cache do fontconfig na imagem
   (o usuário `node` não tem `$HOME` gravável), e o build falha se `sans-serif` não resolver
   para a Inter.

O `/etc/fonts/local.conf`, escrito pelo próprio Dockerfile, torna a Inter a fonte padrão: `Inter`,
`serif`, `sans-serif`, `system-ui` e os nomes que o Chromium usa como padrão no Linux
(`Times New Roman` e `Arial`) resolvem para `Inter Variable`. Texto sem `font-family`, com
uma família genérica ou com `font-family: Inter` sai em Inter. Caracteres que a Inter não tem
(CJK, emoji) caem nas fontes de reserva. Outra fonte, só embutida no template por `data:`
(ADR 0026).

A Inter é variável, e o Chromium a grava no PDF como fonte Type 3 (contornos vetoriais, com
`ToUnicode`): o texto continua selecionável e pesquisável.

## Compose

`apps/worker/docker-compose.yml`: limite de 640 MB (`NUVA_WORKER_MEMORY`, padrão `640m`, o
mesmo do `.env`) e `/tmp` em `tmpfs` de 128 MB, onde o navegador guarda o perfil (ele roda com
`--disable-dev-shm-usage`). Raiz somente leitura, `cap_drop: ALL`, `no-new-privileges` e
usuário `node` (UID 1000) continuam. A sandbox do Chromium fica desligada, que é o padrão do
Playwright (ADR 0026).

Soma dos limites do perfil padrão (RNF-02, até 3 GB): `postgres` 1024 + `migrate` 256 +
`admin-api` 384 + `classroom-api` 512 + `worker` 640 + `admin` 64 + `classroom` 64 = 2944 MB.
O `scripts/compose.test.mjs` confere a soma, o limite e o `tmpfs`.

Prova (tarefa 465), nas duas plataformas, com as mesmas restrições do Compose
(`--read-only`, `--tmpfs /run`, `--tmpfs /tmp:size=128m`, `--cap-drop ALL`,
`no-new-privileges`, `--memory 640m`, `--cpus 1`, usuário `node`): o renderizador do worker
(`src/certificates/renderer.ts`) gerou quatro PDFs de exemplo (sem `font-family`, `serif`,
`sans-serif` e `Inter`); o `pdffonts` mostra `InterVariable` nos quatro, com WenQuanYi Zen Hei e
Noto Color Emoji nos caracteres CJK e no emoji. Pico de memória do contêiner (`memory.peak` do
cgroup): 334 MB.

## Tamanho

Medido em 2026-11-26, Chromium headless shell 159.0.8154.6 (`playwright-core` 1.65.1), base
`node:26-slim` (Debian 13.8). "Compactado" é o que se baixa do Docker Hub; "em disco" é o
`du -sxm /` dentro do contêiner.

| Plataforma | Antes (compactado / em disco) | Depois (compactado / em disco) | Diferença em disco |
| --- | --- | --- | --- |
| `linux/amd64` | 102 MB / 304 MB | 359 MB / 918 MB | +614 MB |
| `linux/arm64` | 103 MB / 324 MB | 358 MB / 931 MB | +607 MB |

Para onde vão os cerca de 610 MB (arm64):

| Parte | Tamanho |
| --- | --- |
| Chromium headless shell (`/ms-playwright`) | 283 MB |
| Mesa, dependência do `libgbm1`, que o executável liga (`libLLVM` 120 MB, `libgallium` 34 MB, `libz3` 26 MB) | 180 MB |
| Fontes (`/usr/share/fonts`, das quais a Inter tem 1,8 MB) | 92 MB |
| Demais bibliotecas e `xvfb` | ~55 MB |

A ADR 0026 estimava cerca de 300 MB; o compactado cresceu 257 MB e o em disco, o dobro
disso. O que poderia sair sem trocar a decisão é o grupo "tools" do `--with-deps` (`xvfb`,
Unifont e as demais fontes de reserva), perto de 90 MB, ao preço de instalar a lista de pacotes
à mão em vez do comando da spec. Mudar isso é decisão do `arquiteto`.

## Trivy

`aquasec/trivy:0.76.2`, mesma base de dados nas quatro varreduras (2026-11-26). Contagem de
todas as vulnerabilidades encontradas, com e sem correção publicada; o fluxo `images` só barra
alta ou crítica **com** correção (`--severity HIGH,CRITICAL --ignore-unfixed`).

| Imagem | Crítica | Alta | Média | Baixa | Desconhecida | Total | Alta ou crítica com correção |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Antes (amd64 e arm64) | 0 | 51 | 77 | 73 | 15 | 216 | 1 (`libzstd1`, CVE-2026-124851) |
| Depois (amd64 e arm64) | 1 | 88 | 184 | 150 | 21 | 444 | 0 |

- Todas as vulnerabilidades são de pacotes do Debian; os pacotes npm saem limpos.
- A crítica nova é da `libxml2` (CVE-2026-6653), ainda sem correção no Debian 13. Entra como
  dependência das bibliotecas do navegador.
- A imagem antiga falhava no exame do fluxo `images` pela `libzstd1`; o `apt-get upgrade` a
  corrige. A `admin-api` e a `classroom-api` partem da mesma base e não fazem `apt-get upgrade`:
  enquanto o `node:26-slim` não ganhar digest novo, a mesma `libzstd1` as barra.
- O Trivy não enxerga o Chromium baixado pelo Playwright: ele não é pacote do `apt` nem do npm.
  A correção de segurança do navegador chega com a atualização do Playwright (a do e2e e a do
  `playwright-core` do worker andam juntas).

Para refazer a medição:

```bash
docker buildx build --platform linux/amd64 --load -f apps/worker/Dockerfile -t nuva-prova-worker:amd64 .
docker image ls --tree | grep -A1 nuva-prova-worker          # compactado
docker run --rm --user root nuva-prova-worker:amd64 du -sxm / # em disco
docker run --rm -v trivy-cache:/root/.cache/ -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.76.2 image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
  nuva-prova-worker:amd64
docker rmi nuva-prova-worker:amd64
```

## Licenças

O Chromium e os pacotes do Debian não são pacotes npm e não passam pelo passo `licencas` do
`pnpm verify:quick` (ADR 0026). Todos vão com o texto da licença dentro da imagem:

| Componente | Licença | Onde está o texto na imagem |
| --- | --- | --- |
| Chromium headless shell | BSD-3-Clause (The Chromium Authors) e as licenças dos componentes de terceiros que ele inclui (BSD, MIT, Apache-2.0, LGPL, MPL, ICU, entre outras), compatíveis com a distribuição sob AGPL-3.0 (ADR 0016) | `/ms-playwright/chromium_headless_shell-<revisão>/chrome-headless-shell-<plataforma>/LICENSE.headless_shell` (o arquivo de créditos completo, cerca de 2,2 MB) |
| `playwright-core` | Apache-2.0 | `/app/node_modules/.pnpm/playwright-core@<versão>/node_modules/playwright-core/LICENSE` e `NOTICE`; passa pelo passo `licencas` |
| Inter (`fonts-inter-variable`) | OFL-1.1 | `/usr/share/doc/fonts-inter-variable/copyright` |
| Fontes de reserva e bibliotecas do `--with-deps` | as de cada pacote do Debian (fontes sob OFL, GPL com exceção de fonte, IPA, Apache-2.0; bibliotecas sob LGPL, MIT, BSD, MPL) | `/usr/share/doc/<pacote>/copyright`, presente para todos os pacotes instalados |

Para ver o texto de dentro da imagem:

```bash
docker run --rm tmsoftbrasil/nuva-edu-worker:latest sh -c \
  'cat /ms-playwright/chromium_headless_shell-*/*/LICENSE.headless_shell' | less
docker run --rm tmsoftbrasil/nuva-edu-worker:latest cat /usr/share/doc/fonts-inter-variable/copyright
```

A fonte embutida no PDF não muda a licença do documento: a OFL-1.1 libera expressamente os
documentos criados com a fonte.
