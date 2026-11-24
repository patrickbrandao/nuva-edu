# Módulos do núcleo

Uma pasta por área de negócio; `jobs`, `settings` e `stream` estão implementados, as demais ainda vazias. Cada módulo ganha seu código (entidades, regras, consultas Kysely) junto com a tarefa que o implementa, e exporta o que as APIs e o worker usam por `src/index.ts`.

| Pasta | Conteúdo | Spec |
| --- | --- | --- |
| `settings` | Configuração da escola | 003, 031 |
| `accounts` | Cadastro, login, sessão, admin inicial | 007 |
| `permissions` | Papéis e matriz de permissões | 008 |
| `catalog` | Cursos, módulos, aulas, ebooks, pacotes | 009 |
| `entitlements` | Direitos de acesso e cascata | 010 |
| `sales` | Cesta, pedidos, cupons, reembolso | 011 |
| `subscriptions` | Planos e assinaturas | 012 |
| `payments` | Provedor de pagamento, webhook, reconciliação | 013 |
| `learning` | Progresso e conclusão | 014 |
| `certificates` | Certificados | 015 |
| `notes` | Anotações | 016 |
| `forum` | Fórum | 017 |
| `events` | Calendário e eventos | 018 |
| `profiles` | Perfil, seguir, diretório | 019 |
| `gamification` | Pontos, níveis, medalhas | 020 |
| `messages` | Mensagens diretas | 021 |
| `cases` | Cases | 022 |
| `tickets` | Chamados de suporte | 023 |
| `notifications` | Notificações e e-mail | 024 |
| `announcements` | Novidades | 025 |
| `moderation` | Denúncias e moderação | 026 |
| `mcp` | Chaves MCP | 027 |
| `audit` | Auditoria | 028 |
| `images` | Imagens | 029 |
| `privacy` | Termos, exportação e exclusão (LGPD) | 030 |
| `jobs` | Fila de tarefas | 005 |
| `stream` | Eventos em tempo real para o usuário (`NOTIFY nuva_user_events`) | 004 |

Regras:

- Toda regra de acesso e de negócio vive aqui, uma única vez (spec 001, RF-02).
- Cada tabela tem um único componente que escreve nela (spec 001, "Dados"): a função de escrita deixa claro, no nome ou no módulo, a qual componente pertence.
- Erro de regra é `DomainError`; nada de `throw new Error` para o que o cliente precisa entender.
