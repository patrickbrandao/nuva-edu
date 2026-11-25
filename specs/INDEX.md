# Índice das especificações

As specs são a fonte da verdade. Carregue apenas a que a tarefa pedir. Decisões em [decisions/HISTORY.md](decisions/HISTORY.md); plano em [PLAN.md](PLAN.md).

| Arquivo | Título | Escopo | Depende de | Status |
| --- | --- | --- | --- | --- |
| [000-visao-geral.md](000-visao-geral.md) | Visão geral | Propósito, usuários, escopo, MVP, requisitos não funcionais | — | aprovada |
| [001-arquitetura.md](001-arquitetura.md) | Arquitetura | Componentes, dono dos dados, integrações, stack, operação | 000 | aprovada |
| [002-organizacao-do-trabalho.md](002-organizacao-do-trabalho.md) | Organização do trabalho | Papéis, pastas, Git, tarefas, Definition of Done, escalonamento | 000, 001 | aprovada |
| [003-admin-api.md](003-admin-api.md) | admin-api | Serviço da API administrativa | 001 | aprovada |
| [004-classroom-api.md](004-classroom-api.md) | classroom-api | Serviço da API do aluno, SSE | 001 | aprovada |
| [005-worker-e-fila.md](005-worker-e-fila.md) | Worker e fila | Tarefas em segundo plano | 001 | aprovada |
| [006-sites-e-interface.md](006-sites-e-interface.md) | Sites e interface | Sites admin e classroom, telas, `packages/ui`, uso do `/config.json` | 001 | aprovada |
| [007-contas-e-autenticacao.md](007-contas-e-autenticacao.md) | Contas e autenticação | Cadastro, login, senha, sessão, cookies, OAuth e provedor simulado, admin inicial, equipe, avatar, rotas da Fase 1 | 001 | aprovada |
| [008-papeis-e-permissoes.md](008-papeis-e-permissoes.md) | Papéis e permissões | Matriz de permissões por papel | 007 | aprovada |
| [009-catalogo-e-conteudo.md](009-catalogo-e-conteudo.md) | Catálogo e conteúdo | Cursos, módulos, aulas, ebooks, pacotes, vitrine | 008 | aprovada |
| [010-direitos-de-acesso.md](010-direitos-de-acesso.md) | Direitos de acesso | Quem acessa o quê, cascata, concessão manual | 009 | aprovada |
| [011-vendas-e-checkout.md](011-vendas-e-checkout.md) | Vendas e checkout | Cesta, pedidos, cupons, reembolso, CSV | 010 | aprovada |
| [012-assinaturas.md](012-assinaturas.md) | Assinaturas | Planos e ciclo de vida da assinatura | 010, 011 | aprovada |
| [013-pagamentos-mercado-pago.md](013-pagamentos-mercado-pago.md) | Pagamentos e Mercado Pago | Interface de provedor, webhook, reconciliação | 011, 012 | aprovada |
| [014-aprendizado-e-progresso.md](014-aprendizado-e-progresso.md) | Aprendizado e progresso | Player, conclusão, progresso, estante | 010 | aprovada |
| [015-certificados.md](015-certificados.md) | Certificados | Template HTML com palavras-chave, PDF pelo Chromium no worker, validação pública | 014 | aprovada |
| [016-anotacoes.md](016-anotacoes.md) | Anotações | Notas por aula e avulsas | 014 | aprovada |
| [017-forum.md](017-forum.md) | Fórum | Categorias, tópicos, respostas | 010 | aprovada |
| [018-calendario-e-eventos.md](018-calendario-e-eventos.md) | Calendário e eventos | Lives, público, gravações | 010 | aprovada |
| [019-perfil-e-diretorio.md](019-perfil-e-diretorio.md) | Perfil e diretório | Perfil rico, seguir, diretório, presença | 007 | aprovada |
| [020-gamificacao.md](020-gamificacao.md) | Gamificação | Pontos, níveis, medalhas, ranking | 014, 017 | aprovada |
| [021-mensagens-diretas.md](021-mensagens-diretas.md) | Mensagens diretas | Conversa 1:1 em tempo real | 010, 004 | aprovada |
| [022-cases.md](022-cases.md) | Cases | Vitrine de projetos dos alunos | 019, 029 | aprovada |
| [023-chamados-de-suporte.md](023-chamados-de-suporte.md) | Chamados de suporte | Atendimento ao aluno | 008 | aprovada |
| [024-notificacoes-e-email.md](024-notificacoes-e-email.md) | Notificações e e-mail | Central, preferências, e-mail transacional | 004, 005 | aprovada |
| [025-novidades.md](025-novidades.md) | Novidades | Mural de anúncios da escola | 008 | aprovada |
| [026-moderacao-e-denuncias.md](026-moderacao-e-denuncias.md) | Moderação e denúncias | Denúncia, fila, ações, suspensão | 008, 017 | aprovada |
| [027-mcp.md](027-mcp.md) | MCP | Servidor MCP, chaves, ferramentas | 003, 008 | aprovada |
| [028-auditoria.md](028-auditoria.md) | Auditoria | Registro imutável de ações | 003 | aprovada |
| [029-imagens.md](029-imagens.md) | Imagens | Envio, limites, entrega | 001 | aprovada |
| [030-lgpd.md](030-lgpd.md) | LGPD | Termos, exportação, exclusão | 007 | aprovada |
| [031-infraestrutura-e-deploy.md](031-infraestrutura-e-deploy.md) | Infraestrutura e deploy | Docker, variáveis, segredos exigidos, `/config.json` dos sites, ambientes, proxy e SSE atrás dele | 001 | aprovada |
| [032-verificacao-e-ci.md](032-verificacao-e-ci.md) | Verificação e CI | `verify:quick`, `verify:full` e seus passos, lint, CI, versão nas imagens | 001, 002 | aprovada |
| [033-observabilidade-retencao-backup.md](033-observabilidade-retencao-backup.md) | Observabilidade, retenção e backup | Logs, saúde, métricas, status 499, expurgo, backup, ameaças | 001, 005 | aprovada |
