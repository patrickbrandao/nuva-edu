# Módulos do núcleo

Uma pasta por área de negócio; `accounts`, `audit`, `images` (envio, variantes, entrega, exclusão e expurgo das órfãs), `jobs`, `notifications`, `oauth`, `permissions`, `privacy`, `settings`, `stream` e `markdown` têm código. Os da Fase 2 também: `catalog` (escrita e leitura), `entitlements` (tarefa 412), `learning` (413), `notes` (414, 596) e `certificates` (466, 415). As demais pastas estão vazias. Cada módulo ganha seu código (entidades, regras, consultas Kysely) junto com a tarefa que o implementa.

Os módulos da Fase 1 (`accounts`, `audit`, `images`, `jobs`, `notifications`, `oauth`, `permissions`, `privacy`), os da Fase 2 (`catalog`, `entitlements`, `learning`, `certificates`, `notes`) e `markdown` exportam pelo próprio `index.ts`, ligado ao `src/index.ts` por `export *`: a tarefa de um módulo altera só a pasta dele. Dois módulos não podem exportar o mesmo nome (o `export *` do `src/index.ts` fica ambíguo): prefixe com o assunto do módulo. Em `accounts`, a gestão pela equipe fica em `management/`, com `index.ts` próprio reexportado pelo do módulo. Os demais seguem com exportação nomeada no `src/index.ts` até ganharem o seu `index.ts`.

| Pasta | Conteúdo | Spec |
| --- | --- | --- |
| `settings` | Configuração da escola (inclusive quem assina o certificado) | 003, 031 |
| `accounts` | Cadastro, login, sessão, admin inicial; gestão de usuários pela equipe em `management/` | 007 |
| `oauth` | Login social: provedores Google, Facebook e Apple, `id_token`, vínculo | 007 |
| `permissions` | Papéis e matriz de permissões | 008 |
| `catalog` | Cursos, módulos, aulas, ebooks, pacotes. Escrita para a admin-api (`courses.ts`, `structure.ts`, `products.ts`); leitura: vitrine pública (`showcase.ts`), usuário logado do classroom (`classroom.ts`, com a decisão de acesso de `entitlements`) e listas e detalhes do admin (`admin-views.ts`). URL de conteúdo só sai de `getLessonContent`, `getEbookDownload` e das leituras do admin | 009 |
| `markdown` | Markdown saneado compartilhado: pipeline isomórfico `unified`/`remark`/`rehype`, política única de elementos, atributos e protocolos, HTML persistido e leitura do conteúdo anterior à ADR 0027. Também em `@nuva-edu/core/markdown` | 017 |
| `entitlements` | Direitos de acesso: concessão (inclusive manual pela equipe), revogação, cascata, recálculo (`entitlement.recompute`) e decisão de acesso | 010 |
| `sales` | Cesta, pedidos, cupons, reembolso | 011 |
| `subscriptions` | Planos e assinaturas | 012 |
| `payments` | Provedor de pagamento, webhook, reconciliação | 013 |
| `learning` | Progresso por aula, módulo e curso, conclusão (`course.completed`, `course.completion_check`), estante, "continuar", mapa de atividade e as leituras da equipe | 014 |
| `certificates` | Certificados: emissão, código, validação pública, gestão pela equipe, templates (funções puras em `template/`), pedidos de exemplo e o estado para o aluno. O PDF é renderizado no worker | 015 |
| `notes` | Anotações por aula e avulsas, privadas do dono | 016 |
| `forum` | Fórum | 017 |
| `events` | Calendário e eventos | 018 |
| `profiles` | Perfil, seguir, diretório | 019 |
| `gamification` | Pontos, níveis, medalhas | 020 |
| `messages` | Mensagens diretas | 021 |
| `cases` | Cases | 022 |
| `tickets` | Chamados de suporte | 023 |
| `notifications` | Notificações e e-mail; tipo sem modelo no worker fica em `PendingTemplateEmailType` até o modelo chegar (hoje nenhum) | 024 |
| `announcements` | Novidades | 025 |
| `moderation` | Denúncias e moderação | 026 |
| `mcp` | Chaves MCP | 027 |
| `audit` | Auditoria | 028 |
| `images` | Imagens | 029 |
| `privacy` | Termos, exportação e exclusão (LGPD) | 030 |
| `jobs` | Fila de tarefas; tipo sem manipulador no worker fica em `PendingHandlerJobType` até o manipulador chegar (hoje nenhum) | 005 |
| `stream` | Eventos em tempo real para o usuário (`NOTIFY nuva_user_events`) | 004 |

Regras:

- Toda regra de acesso e de negócio vive aqui, uma única vez (spec 001, RF-02).
- Cada tabela tem um único componente que escreve nela (spec 001, "Dados"): a função de escrita deixa claro, no nome ou no módulo, a qual componente pertence.
- Erro de regra é `DomainError`; nada de `throw new Error` para o que o cliente precisa entender.
