# e2e

Testes de ponta a ponta (Playwright) contra o ambiente Compose completo. Spec:
`specs/032-verificacao-e-ci.md`.

```bash
pnpm --filter @nuva-edu/e2e run browsers   # uma vez: baixa o Chromium
pnpm verify:full --e2e                     # nível completo, com o e2e no fim
pnpm --filter @nuva-edu/e2e test           # só o e2e
```

Antes dos testes, a configuração sonda os dois sites e o `/healthz` das duas APIs. Se tudo
responde, reutiliza o ambiente; se não, roda `pnpm dev:up` e sonda de novo. Nunca derruba o
ambiente. Quando algo continua fora do ar, o erro traz a URL que não respondeu e o comando.

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `NUVA_E2E_ADMIN_URL` | `http://edu-admin.localhost:8080` | Endereço do site admin (e da admin-api) |
| `NUVA_E2E_CLASSROOM_URL` | `http://classroom.localhost:8080` | Endereço do site do aluno (e da classroom-api) |
| `NUVA_E2E_COMPOSE` | (ligado) | `0`: não sobe o ambiente nem usa `docker compose exec` |
| `NUVA_E2E_MAILPIT_URL` | `http://127.0.0.1:8025` | API HTTP do Mailpit, de onde os testes leem os e-mails |

- Seletores por papel e nome acessível (`getByRole`, `getByLabel`), nunca por classe CSS.
- O `/healthz` do worker não passa pelo proxy: o teste o consulta com `pnpm compose exec worker`
  e é pulado com `NUVA_E2E_COMPOSE=0`.
- O painel exige sessão: o projeto `setup` (`tests/admin.setup.ts`) entra com o admin inicial,
  lendo `ADMIN_EMAIL` e `ADMIN_PASSWORD` do ambiente ou do `.env.local` da raiz, e guarda a
  sessão em `tmp/playwright/auth/`. Os valores nunca vão para log nem relatório.
- Fluxos do critério de saída da Fase 1 em `tests/fase1/` (projetos `fase1` e `fase1-termos`; este
  publica versão nova dos termos e roda por último). Cada execução usa e-mails novos: o banco não
  é zerado.
- Fluxos do critério de saída da Fase 2 em `tests/fase2/` (projeto `fase2`, um worker por vez; o
  `fase1-termos` espera por ele, porque versão nova dos termos prenderia as sessões dos alunos na
  tela de aceite):
  - `curso-aberto.spec.ts`: o instrutor monta e publica um curso aberto; o visitante o vê na
    vitrine; o aluno conclui pelo fim do vídeo e pelo botão, anota, vê "certificado ainda não
    liberado"; o instrutor confere o PDF de exemplo e salva o template; o certificado chega por
    e-mail, com o texto do template no PDF, e é validado na página pública. Exige que a instalação
    não tenha template padrão do certificado.
  - `curso-pago.spec.ts`: curso pago bloqueado, com preço, programa e amostra; a concessão manual
    do gerente libera e avisa por e-mail.
  - `template-recusado.spec.ts`: template com `<script>` ou imagem externa recusado na tela, com a
    regra e a linha.
  - `lcp-vitrine.spec.ts`: mede o LCP da vitrine com cursos publicados e capas reais
    (`fixtures/capa.png`), em 4G simulada pelo CDP (`Network.emulateNetworkConditions`, perfil
    "Regular 4G": 150 ms, 1,6 Mbps/750 Kbps, cache desligado) e `PerformanceObserver` de
    `largest-contentful-paint` instalado antes dos scripts da página. Falha acima de 2,5 s
    (spec 006, RNF-04) e informa o valor e o elemento no log.
  - O vídeo das aulas é `fixtures/aula.webm` (3 s, VP9), servido pelo próprio teste com
    `context.route` num host fictício (`support/fase2.ts`): nada sai para provedor de vídeo.
  - O texto do PDF é lido por `support/pdf.ts`, um leitor mínimo para o que o Chromium gera.
- CSP dos players (tarefa 065): `tests/fase2/csp-players.spec.ts` abre uma aula de cada provedor da
  spec 009 num curso aberto e falha se o documento do classroom registrar `securitypolicyviolation`
  ou erro "Content Security Policy" no console (a vigia é `support/csp.ts`; `tests/csp-vigia.spec.ts`
  prova que ela registra a violação do documento). As URLs de YouTube, Vimeo, Bunny e Panda são os
  exemplos públicos dos testes do `VideoPlayer`, não links de uma escola real: o que se confere é o
  pedido sair sem ser barrado, não o vídeo tocar. O `.mp4` é o `fixtures/aula.webm` servido pelo
  próprio teste sob esse nome (a classificação é pela extensão) e toca até o fim. O que acontece
  dentro do `iframe` do provedor é da política dele, não do classroom.
- CSP do admin: o mesmo arquivo confere o cabeçalho do admin — nenhuma origem externa (host ou `*`)
  em diretiva alguma e nenhum esquema fora de `img-src`, que aceita `https:` (as imagens do
  Markdown saneado, ADR 0027), `data:` e `blob:`. Política que abra `script-src`, `frame-src`,
  `connect-src` ou ponha `http:` na imagem reprova. A do classroom continua exigindo a IFrame API
  do YouTube. Como a CSP sai do `index.html` no build da imagem, rode `pnpm dev:up` no checkout
  principal antes do e2e: imagem antiga serve a política antiga.
- Atrás do Traefik local todo pedido do navegador chega com o mesmo IP. Por isso:
  - as operações de autenticação feitas pela tela esperam a vez em `support/pacing.ts` (abaixo
    de 10 por minuto no classroom e 20 no admin, os limites por IP das APIs);
  - o preparo de contas e as tentativas que precisam falhar (senha errada, senha antiga) vão
    direto à API pela rede interna, de dentro do contêiner do worker, com um IP de documentação
    sorteado (`support/isolated.ts`). Sem isso, 5 falhas bloqueariam por 15 minutos o IP de
    todos os testes. Esses testes exigem o Compose local.
- A varredura (`tests/fase1/varredura.spec.ts`) lê `pnpm compose logs` desde o início do teste.
- Relatório e rastros em `tmp/playwright/` (fora do Git).
