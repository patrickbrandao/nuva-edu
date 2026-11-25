# Plano de implementação

Cada fase termina em algo utilizável. As tarefas de uma fase são criadas em `tasks/` pelo `arquiteto` quando a fase anterior é concluída. Papéis e regras de paralelismo em [002](002-organizacao-do-trabalho.md).

## Fase 0 — Fundação

- **Objetivo:** repositório, monorepo, Docker, banco, esqueleto dos cinco serviços, biblioteca de interface e verificação funcionando.
- **Specs:** [001](001-arquitetura.md), [002](002-organizacao-do-trabalho.md), [003](003-admin-api.md), [004](004-classroom-api.md), [005](005-worker-e-fila.md), [006](006-sites-e-interface.md), [031](031-infraestrutura-e-deploy.md), [032](032-verificacao-e-ci.md).
- **Depende de:** nada.
- **Sequencial:** repositório e monorepo (`infra`) → todo o resto.
- **Em paralelo, depois do monorepo:**
  - `banco`: comando de migrations e migration inicial.
  - `arquiteto`: os dois `openapi.yaml` iniciais.
  - `interface`: `packages/ui` a partir do minui-react.
  - `infra`: script de verificação, lefthook, CI.
  - Depois de banco e contratos: `nucleo` (base de `packages/core`), então `api-admin`, `api-classroom` (API e worker), `web-admin` e `web-classroom` em paralelo.
- **Critério de saída:** `docker compose up` sobe tudo; `/healthz` responde nos três serviços de backend; os dois sites abrem em `edu-admin.localhost` e `classroom.localhost`; `pnpm verify:quick` e `pnpm verify:full` passam; o CI passa na `main`; `pnpm deploy:test` publica no servidor de testes.

## Fase 1 — Contas

- **Objetivo:** cadastro, login por todos os métodos, papéis e gestão de usuários.
- **Specs:** [007](007-contas-e-autenticacao.md), [008](008-papeis-e-permissoes.md), [028](028-auditoria.md), [029](029-imagens.md) (só avatar e entrega), [024](024-notificacoes-e-email.md) (só o envio de e-mail), [030](030-lgpd.md) (só termos e aceite), [031](031-infraestrutura-e-deploy.md) (segredos, volumes, perfil `oauth-mock`); [0024](decisions/0024-provedor-oauth-simulado.md).
- **Depende de:** Fase 0.
- **Tarefas:** 131 a 167 em `tasks/`. A antiga 116 (nome do volume) foi decidida na 031 e virou as tarefas 134 e 135.
- **Frentes paralelas, por onda** (cada uma começa quando as dependências da tarefa saem da fila):
  1. Logo após a spec: janela 131 (`arquiteto` publica os dois contratos da fase com `x-nuva-pending`, `interface` regenera o cliente na 132); `interface` 133 (diálogo, aviso, campo de senha, seletor de imagem); `infra` 134 (migração de volume) e 158 (provedor OAuth simulado); `api-admin` 136 (base HTTP: cookies, limite de taxa, formulário, multipart); `banco` 137 (imagens).
  2. Migrations em sequência (`banco` 138 → 139 → 140) e, à parte, 135 (nome dos volumes). Com o cliente da 132: sites começam contra o cliente, com respostas simuladas nos testes: `web-classroom` 160 → 161 e `web-admin` 162 → 163 → 164.
  3. Núcleo: 141 (tipos e base) → em paralelo 142 (permissões), 143 (auditoria), 144 (e-mail e fila), 145 (imagens), 147 (termos) → 146 (contas) → em paralelo 148 (OAuth) e 149 (gestão pela equipe).
  4. APIs, cada uma no próprio worktree (as operações já estão no contrato): `api-classroom` 152 → 153 e worker 150 → 151; `api-admin` 154 → 155 → 156. Depois, `infra` 157 (segredos exigidos no Compose, `oauth-mock` no `dev:up` e no CI) e `arquiteto` 165 (retira `x-nuva-pending`).
  5. `testador` 166 (e2e do critério de saída), com o ambiente reconstruído pelo humano.
- **Itens de infraestrutura da fase:** o Compose passa a exigir `SESSION_SECRET` (nas duas APIs) e `ADMIN_EMAIL` e `ADMIN_PASSWORD` (na `admin-api`) com `${VAR:?}` na tarefa 157, depois de o código usá-los ([031](031-infraestrutura-e-deploy.md), "Segredos exigidos"); o humano acrescenta os três ao `.env.local` local antes do próximo `pnpm dev:up` e ao do servidor de testes antes do primeiro `pnpm deploy:test` da fase (tarefa 159). Os volumes passam a ter o prefixo do projeto, com migração automática no `dev:up` e, no servidor, por `pnpm deploy:test --migrate-volume` (humano).
- **E-mail:** o critério de saída é cumprido com o Mailpit local; o servidor de testes passa a subir o perfil `mailpit` até haver SMTP real (credencial do humano, não exigida nesta fase).
- **Critério de saída:** uma pessoa se cadastra por senha e por cada provedor (contra o provedor simulado), confirma o e-mail e redefine a senha, com os e-mails conferidos no Mailpit; cadastro com termos publicados exige o aceite; 5 senhas erradas bloqueiam a conta; o admin inicial nasce das variáveis; o admin cria gerente e instrutor, suspende um aluno (que perde a sessão e não entra) e vê a senha de um usuário com registro na auditoria; o gerente não vê senha nem auditoria; o aluno troca o avatar; a varredura não encontra a senha de teste fora da rota de exibição; e2e desses fluxos passa; `pnpm deploy:test` publica a fase no servidor de testes.
- **Precisa do humano:** segredos no `.env.local` local e do servidor; `--migrate-volume` no servidor e remoção do volume antigo; credenciais de Google, Facebook e Apple, só para ligar os provedores reais (tarefa 167, fora do critério de saída); SMTP real de teste, opcional.

## Fase 2 — Catálogo e aprendizado

- **Objetivo:** publicar conteúdo e assistir.
- **Specs:** [009](009-catalogo-e-conteudo.md), [010](010-direitos-de-acesso.md) (fonte `grant` e cascata; `order` e `subscription` na Fase 3), [014](014-aprendizado-e-progresso.md), [015](015-certificados.md), [016](016-anotacoes.md); e as partes que elas usam de [005](005-worker-e-fila.md) (tarefas da fila), [008](008-papeis-e-permissoes.md) (`certificate.issue`), [024](024-notificacoes-e-email.md) ("E-mails da Fase 2"), [028](028-auditoria.md), [029](029-imagens.md) (`product_cover`) e [031](031-infraestrutura-e-deploy.md) (chaves `certificate.*`); [0025](decisions/0025-bibliotecas-da-fase-2.md). Cada spec diz o que fica para fases seguintes ("O que fica para outras fases" ou "Entrega por fase").
- **Depende de:** Fase 1.
- **Tarefas:** 401 a 462 em `tasks/`, mais a 065 (CSP dos players), que já estava na fila.
- **Antes da onda 1:** o humano responde às perguntas P1 a P6 do relato da tarefa 400 (nome no certificado; exclusão e arquivamento de curso com alunos; quem define o modo de acesso; identidade da escola no certificado; HLS de host fora da tabela; produto pago sem vendas) e o `arquiteto` leva as respostas às specs e às tarefas afetadas (401, 408, 410, 415, 450, 454, 065). Só então abre a janela 401.
- **Frentes paralelas, por onda** (cada tarefa começa quando as dependências saem da fila):
  1. Janela 401 (`arquiteto` publica os dois contratos da fase com `x-nuva-pending`; `interface` regenera o cliente na 402; não há escrita nova sem `csrfToken`, então nenhuma tarefa de exceção de CSRF). Em paralelo: `banco` 403 (catálogo); `interface` 404 (Markdown, lista reordenável, acordeão, abas, barra de progresso, cartão de produto); `nucleo` 405 (base: módulos, tipos da fila e de e-mail como pendentes, chaves `certificate.*`, `certificate.issue`).
  2. Migrations em sequência: `banco` 406 (direitos) → 407 (progresso, atividade, anotações) → 408 (certificados). `interface` 409 (player por provedor, mapa de atividade). Com o cliente da 402 e os componentes da 404, os sites começam contra o cliente, com respostas simuladas nos testes: `web-admin` 440 → 441 → 442 → 443 e `web-classroom` 450 → 451 (também depende da 409) → 452 → 453 → 454.
  3. Núcleo: 410 (catálogo, escrita) e 412 (direitos) em paralelo → 411 (catálogo, leitura) e 414 (anotações) → 413 (aprendizado) → 415 (certificados).
  4. APIs e worker, cada tarefa no próprio worktree (as operações já estão no contrato): `api-admin` 420 → 421 → 422 → 423; `api-classroom` 430 → 431 → 432 → 433; worker 434 (recálculo da cascata, e-mail `access.granted`) → 435 (conclusão do curso, PDF do certificado, e-mail `certificate.issued`). Depois: `nucleo` 416 (tira os pendentes da fila e do e-mail), `infra` 065 (CSP do classroom, depois de 409 e 451) e `arquiteto` 460 (retira `x-nuva-pending`).
  5. `testador` 461 (e2e do critério de saída), com o ambiente reconstruído pelo humano; depois `infra` 462 (`pnpm deploy:test` e conferência no servidor).
- **Carga no banco compartilhado:** no máximo três tarefas com suíte de banco pesada ao mesmo tempo (núcleo, APIs, worker, migrations); as dos sites e da `interface` não contam. Na onda 4 isso já são as três filas (`api-admin`, `api-classroom`, worker): o núcleo 415 termina antes de a 423 e a 433 começarem.
- **Dependências novas:** `react-markdown`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@vimeo/player` e `hls.js` em `packages/ui` (404, 409); `pdfkit` e `qrcode` no worker (435). Cada uma passa pela conferência de licenças do `verify:quick`.
- **Itens de infraestrutura da fase:** nenhuma variável, segredo ou volume novo: a fonte do certificado vai dentro da imagem do worker, e o PDF fica no banco. A CSP do classroom passa a ter as origens dos players (065, ADR 0025), o que exige reconstruir a imagem do classroom; o e2e roda no ambiente reconstruído pelo humano no checkout principal.
- **E-mail:** `access.granted` e `certificate.issued` saem por `enqueueEmail`, conferidos no Mailpit, até a central de notificações da Fase 4.
- **Critério de saída:** um instrutor publica um curso aberto com módulos e aulas; um visitante o vê na vitrine; um aluno assiste, conclui, anota e recebe o certificado, validável pela página pública; curso pago aparece bloqueado, com programa visível e aula de amostra liberada; concessão manual libera o acesso; e2e desses fluxos passa, sem depender de provedor de vídeo externo; `pnpm deploy:test` publica a fase no servidor de testes.
- **Precisa do humano:** as respostas a P1–P6 antes da janela 401; reconstruir o ambiente local (`pnpm dev:up` no checkout principal) antes do e2e; conferência visual de uma aula de cada provedor real (YouTube, Vimeo, Bunny, Panda) com links de teste da escola, na 065, se os agentes não tiverem acesso a eles.

## Fase 3 — Vendas

- **Objetivo:** vender avulso e por assinatura.
- **Specs:** [011](011-vendas-e-checkout.md), [012](012-assinaturas.md), [013](013-pagamentos-mercado-pago.md), [010](010-direitos-de-acesso.md) (cascata).
- **Depende de:** Fase 2.
- **Sequencial:** interface de pagamento no `nucleo` → Mercado Pago → cesta e checkout → assinaturas.
- **Em paralelo:** planos, cupons e relatório de vendas no admin, enquanto o checkout é feito no classroom.
- **Critério de saída:** em modo de teste do Mercado Pago, um aluno compra um pacote com cupom e recebe cursos e ebooks em cascata; assina um plano e perde o acesso ao vencer a carência; o admin reembolsa e o acesso é revogado; webhook repetido não duplica nada; o CSV de vendas confere.
- **Precisa do humano:** conta de teste do Mercado Pago.

## Fase 4 — Fórum e suporte

- **Objetivo:** conversa assíncrona, atendimento e avisos.
- **Specs:** [017](017-forum.md), [018](018-calendario-e-eventos.md), [023](023-chamados-de-suporte.md), [024](024-notificacoes-e-email.md), [025](025-novidades.md), [026](026-moderacao-e-denuncias.md).
- **Depende de:** Fase 2 (fórum depende de cursos e direitos). Pode começar em paralelo com a Fase 3.
- **Em paralelo:** fórum e moderação; chamados; calendário; novidades. Notificações e SSE vêm antes dos recursos que as disparam.
- **Critério de saída:** publicar uma aula cria o tópico; só quem tem o curso responde; denúncia chega à fila e o gerente oculta a postagem; um chamado é aberto, respondido e encerrado, com notificação no sino e por e-mail; um evento restrito aparece bloqueado para quem não tem acesso.

## Fase 5 — Administração por MCP

- **Objetivo:** operar a escola por agentes de IA.
- **Specs:** [027](027-mcp.md), [028](028-auditoria.md).
- **Depende de:** Fases 1 a 4 (as ferramentas espelham a API administrativa existente).
- **Em paralelo:** emissão de chaves no `web-admin` e ferramentas no `api-admin`.
- **Critério de saída:** um gerente emite duas chaves; um cliente MCP lista usuários e concede acesso com a primeira; uma ferramenta exclusiva de admin é recusada; revogar a chave bloqueia na hora; rebaixar o emissor reduz o que a chave faz; tudo aparece na auditoria; nenhuma ferramenta devolve senha.

## Fase 6 — Comunidade

- **Objetivo:** perfil rico, diretório, gamificação, mensagens diretas e cases.
- **Specs:** [019](019-perfil-e-diretorio.md), [020](020-gamificacao.md), [021](021-mensagens-diretas.md), [022](022-cases.md).
- **Depende de:** Fase 4 (SSE, notificações, moderação).
- **Em paralelo:** as quatro frentes são independentes entre si depois das migrations.
- **Critério de saída:** um aluno completa o perfil e aparece no diretório; ganha pontos, sobe de nível e recebe medalha; troca mensagens em tempo real com outro aluno com acesso ativo e bloqueia um terceiro; publica um case com aceite de exibição pública, visível a visitantes.

## Fase 7 — Versão 1.0

- **Objetivo:** fechar conformidade, operação e documentação.
- **Specs:** [030](030-lgpd.md), [033](033-observabilidade-retencao-backup.md), [031](031-infraestrutura-e-deploy.md), [000](000-visao-geral.md) (RNF).
- **Depende de:** todas as anteriores.
- **Em paralelo:** LGPD; backup e restauração; documentação em VitePress; teste de carga com k6; revisão das seis ameaças.
- **Critério de saída:** exportação e exclusão de conta funcionam; restauração de backup comprovada no CI; teste de carga comprova 500 simultâneos com p95 abaixo de 300 ms em 2 vCPU e 4 GB; instalação limpa em até 15 minutos seguindo a documentação; tag `v1.0.0` publica imagens e documentação.
