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
- **Specs:** [009](009-catalogo-e-conteudo.md), [010](010-direitos-de-acesso.md), [014](014-aprendizado-e-progresso.md), [015](015-certificados.md), [016](016-anotacoes.md).
- **Depende de:** Fase 1.
- **Em paralelo:** catálogo no admin (`api-admin`, `web-admin`) e vitrine, player e progresso no classroom (`api-classroom`, `web-classroom`); certificados no `worker`.
- **Critério de saída:** um instrutor publica um curso aberto com módulos e aulas; um visitante o vê na vitrine; um aluno assiste, conclui, anota e recebe o certificado, validável pela página pública; curso pago aparece bloqueado, com programa visível e aula de amostra liberada; concessão manual libera o acesso.

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
