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
- **Specs:** [007](007-contas-e-autenticacao.md), [008](008-papeis-e-permissoes.md), [028](028-auditoria.md), [029](029-imagens.md), [024](024-notificacoes-e-email.md) (só o envio de e-mail).
- **Depende de:** Fase 0.
- **Em paralelo:** `api-classroom` (cadastro, login, sessão) e `api-admin` (gestão de usuários, equipe, auditoria), depois de contrato, migration e núcleo; em seguida `web-classroom` e `web-admin`; `testador` ao final.
- **Itens de infraestrutura da fase:** o Compose passa a exigir `SESSION_SECRET` (nas duas APIs) e `ADMIN_EMAIL` e `ADMIN_PASSWORD` (na `admin-api`) com `${VAR:?}`, no mesmo conjunto de tarefas em que o código começa a usá-los ([031](031-infraestrutura-e-deploy.md), "Segredos exigidos"); o `.env.local` do servidor de testes recebe os três antes do primeiro `pnpm deploy:test` da fase (humano).
- **Critério de saída:** uma pessoa se cadastra por senha e por cada provedor, confirma o e-mail e redefine a senha; o admin inicial nasce das variáveis; o admin cria gerente e instrutor, suspende um aluno e vê a senha de um usuário com registro na auditoria; e2e desses fluxos passa.
- **Precisa do humano:** credenciais de Google, Facebook e Apple.

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
