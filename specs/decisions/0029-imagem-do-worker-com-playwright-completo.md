# 0029 — Imagem do worker: manter as dependências do Playwright e o tamanho medido

Status: aceita (substitui só a consequência "tamanho da imagem" da [0026](0026-certificado-por-template-html.md))
Data: 2026-11-26

## Contexto

A [0026](0026-certificado-por-template-html.md) decidiu o PDF do certificado pelo Chromium headless shell do `playwright-core`, instalado com `playwright install --with-deps --only-shell chromium` no estágio de execução da imagem do worker. Estimou o crescimento em "cerca de 300 MB" e deixou o número real para ser medido e registrado pela tarefa de infraestrutura.

A tarefa 465 construiu a imagem e mediu, em 2026-11-26, Chromium headless shell 159.0.8154.6 (`playwright-core` 1.65.1) sobre `node:26-slim` (Debian 13.8), com o registro completo em [`docs/imagem-do-worker.md`](../../docs/imagem-do-worker.md):

| Plataforma | Antes (compactado / em disco) | Depois (compactado / em disco) |
| --- | --- | --- |
| `linux/amd64` | 102 MB / 304 MB | 359 MB / 918 MB |
| `linux/arm64` | 103 MB / 324 MB | 358 MB / 931 MB |

- O compactado cresceu 257 MB (amd64) e 255 MB (arm64), dentro da ordem da estimativa. O que cresceu o dobro foi o tamanho em disco (+614 MB e +607 MB).
- Onde estão os cerca de 610 MB (arm64): Chromium headless shell 283 MB; Mesa, que o `libgbm1` liga (`libLLVM`, `libgallium`, `libz3`), 180 MB; fontes, 92 MB (a Inter, 1,8 MB); demais bibliotecas e `xvfb`, ~55 MB.
- A prova da tarefa 465, nas duas plataformas e com as mesmas restrições do Compose, gerou quatro PDFs com a Inter e mostrou WenQuanYi Zen Hei e Noto Color Emoji nos caracteres CJK e no emoji, com pico de 334 MB do limite de 640 MB.
- O Trivy foi de 216 para 444 achados, todos de pacotes do Debian e nenhum npm. Das altas e críticas, zero tem correção publicada; a única crítica nova (`libxml2`, sem correção) vem das bibliotecas do navegador.
- A tarefa 462 validou certificados e PDFs reais no ambiente local e no servidor de testes.

O mesmo documento aponta o único corte possível sem trocar a decisão: substituir o grupo de ferramentas do `--with-deps` (`xvfb`, Unifont e as demais fontes de reserva) por uma lista manual de pacotes, perto de 90 MB em disco, e atribui a escolha ao `arquiteto`.

O fato novo é a medição: a imagem é cerca de três vezes maior em disco do que o compactado, e o corte conhecido é de aproximadamente 10 % do tamanho final em disco, não do que se baixa.

## Decisão

1. **A imagem fica como está.** O `playwright install --with-deps --only-shell chromium`, o grupo de fontes de reserva, a Inter, o `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, o ffmpeg removido, o `apt-get upgrade` e o `fc-cache` medidos na tarefa 465 continuam sendo a decisão. O tamanho aceito é **918 MB (amd64) / 931 MB (arm64) em disco; 359/358 MB compactado**, registrado em `docs/imagem-do-worker.md` e citado na [031](../031-infraestrutura-e-deploy.md).
2. **Não se troca o `--with-deps` por lista manual de pacotes.** Motivos, em ordem de peso:
   - **O ganho é marginal.** Cerca de 90 MB em disco sobre ~920 MB, e menos no download, porque fontes e `xvfb` são justamente o que mais comprime. O peso da imagem não vem das ferramentas: vem do navegador (283 MB) e da Mesa (180 MB), que nenhuma lista menor dispensa. O corte não muda a viabilidade de instalação da RNF-01 da [031](../031-infraestrutura-e-deploy.md) nem o perfil de 3 GB da RNF-02.
   - **A lista manual envelhece em silêncio.** Quem conhece as bibliotecas de sistema de cada versão do Chromium é o Playwright, que as instala na versão do lockfile junto com o navegador. Uma lista nossa deixa de acompanhar o Chromium sem aviso: o build continua passando (ele só confere a resolução de `sans-serif`), a falha aparece em execução, no `chromium.launch()` sem uma biblioteca compartilhada, e só quando alguém gera um certificado. Nenhum passo do build ou do CI sobe o navegador dentro da imagem para pegar isso antes.
   - **As fontes de reserva não são enfeite.** Sem elas, nome de aluno ou título de curso com caractere CJK ou emoji sai como retângulo vazio no PDF — regressão funcional num documento que o aluno guarda, e justamente o que a prova da tarefa 465 conferiu.
   - **O argumento de segurança não se sustenta no portão do CI.** O fluxo `images` barra alta ou crítica **com** correção, e a imagem tem zero. Os pacotes que puxam a contagem (Mesa, `libLLVM`, `libz3`, `libxml2`) ficam de qualquer forma, porque são ligados pelo navegador.
3. **Não se abre tarefa para cortar só o `xvfb` ou só as fontes.** Qualquer subconjunto do grupo de ferramentas exige a mesma lista manual, com o mesmo risco, para uma fração dos 90 MB.
4. **Nada muda no resto da 0026:** versão do Chromium amarrada à do `playwright-core` do lockfile (a mesma do `@playwright/test` do e2e), JavaScript desligado e rede bloqueada na renderização, 640 MB de memória e `tmpfs` de 128 MB, licenças do navegador em `docs/`, PDF de até 2 MiB.
5. **Condições de revisão.** A decisão volta a ser medida e pode ser substituída por nova ADR se: (a) a base, a versão principal do Playwright ou do Chromium mudar o tamanho de forma material; (b) o tamanho passar a atrapalhar a operação — instalação acima da RNF-01, limite de registro ou disco da escola; (c) o Playwright passar a manter uma instalação realmente mínima (sem o grupo de ferramentas, ou com um Chromium menor); ou (d) um teste que suba o navegador dentro da imagem tornar a lista manual verificável no CI, eliminando o risco de envelhecimento silencioso.

## Alternativas consideradas

- **Lista manual de pacotes no lugar do `--with-deps`** (a hipótese do documento): economiza cerca de 90 MB em disco e passa a exigir manutenção nossa a cada versão do Chromium, com a falha descoberta em execução. Rejeitada pelo risco desproporcional ao ganho.
- **Manter o `--with-deps` e remover só o `xvfb`:** o headless shell não precisa de servidor X, mas separá-lo do comando exige a mesma lista manual, e o ganho é menor que os 90 MB. Rejeitada junto com a anterior.
- **Trocar a base para Alpine/musl:** o build oficial do Chromium do Playwright é para distribuições com glibc; a alternativa custaria um Chromium próprio, fora da versão testada pelo e2e — o mesmo problema de desalinhamento que a 0026 rejeitou no Chromium do Debian.
- **Chromium do pacote do Debian** (já rejeitado na 0026): imagem um pouco menor, versão fora da que o Playwright testa.
- **Serviço de renderização externo** (já rejeitado na 0026): mais um serviço a operar ou dados pessoais saindo da instalação.
- **Voltar ao `pdfkit`** (o que a 0026 substituiu): atenderia ao tamanho, não à decisão do humano de cada curso ter o próprio desenho.

## Consequências

- A estimativa de "cerca de 300 MB" da 0026 deixa de valer como número; valem as medições da tarefa 465, aceitas aqui. O resto da 0026 (comando de instalação, fontes, memória, licenças, riscos) continua valendo.
- `docs/imagem-do-worker.md` é o registro das medições, do Trivy e das licenças; a [031](../031-infraestrutura-e-deploy.md) cita o tamanho aceito e esta ADR. Na próxima vez que o `infra` mexer no documento, a seção "Tamanho" passa a citar esta ADR onde hoje diz que mudar o grupo de ferramentas "é decisão do arquiteto".
- Nenhuma tarefa de `infra` é criada: o `Dockerfile`, a documentação e o desenho da imagem não mudam.
- A imagem do worker fica cerca de 610 MB maior em disco do que a base, e esse custo é aceito em troca de não manter à mão a lista de dependências do navegador e de preservar as fontes de reserva.
- A superfície do Trivy continua a que a medição registrou: 444 achados, nenhum com correção entre as altas e críticas, e a correção do navegador chega pelo Playwright.
- Se o tamanho virar problema de operação, o corte de ~90 MB volta à mesa como ADR nova, com a medição de antes e depois que a tarefa 465 já sabe fazer.
