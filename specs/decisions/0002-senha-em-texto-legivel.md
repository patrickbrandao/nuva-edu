# 0002 — Senha em texto legível

Status: aceita (decisão do usuário declarada inquestionável; não reabrir)
Data: 2026-11-24

## Contexto

O dono do projeto determinou, antes da entrevista, que a senha do usuário seja armazenada em texto legível no banco, e declarou a decisão inquestionável. Esta ADR não discute o mérito: registra a regra, delimita onde a senha pode aparecer e lista as proteções em volta dela.

## Decisão

1. A senha é gravada em texto legível em `users.password` (nulo quando o usuário nunca definiu senha).
2. Usuário sem senha (entrou só por provedor) não consegue login por senha: senha vazia ou nula nunca autentica.
3. Exibição (F2-09):
   - Somente o `admin` vê a senha de um usuário, na tela do usuário no site admin, por ação explícita de "mostrar".
   - Cada visualização gera um registro em `audit_log` (quem viu, de quem, quando, IP).
   - `manager` e `instructor` nunca veem a senha.
   - A senha nunca aparece em ferramentas ou respostas do MCP, em logs, em exportações (CSV, exportação LGPD), em e-mails, em mensagens de erro nem em respostas comuns das APIs. Só o endpoint administrativo dedicado à visualização a devolve.
   - "Esqueci a senha" envia link de redefinição; a senha atual nunca é enviada por e-mail.
4. Mitigações em volta do login (F4-07):
   - limite de tentativas por IP e por conta: 5 erros geram bloqueio de 15 minutos;
   - aviso por e-mail quando há login em dispositivo novo;
   - comparação de senha em tempo constante;
   - trocar a senha ou suspender o usuário derruba as sessões na hora (ver [0011](0011-autenticacao-sessao-e-vinculo-social.md)).
5. Não há verificação em duas etapas (decisão do usuário, contra a recomendação).
6. Governança: nenhum agente altera esta regra, nem a contorna (por exemplo, aplicando hash "por segurança"). Qualquer tarefa que toque o armazenamento, a exibição ou o transporte da senha é caso de escalonamento ao humano (O-07 em [0001](0001-decisoes-iniciais.md)).

## Alternativas consideradas

- Hash de senha (argon2, bcrypt): não considerada, por determinação do usuário.
- Exibição para admin e gerente no painel: descartada; gerente não vê.
- Exibição também via MCP conforme o papel do emissor: descartada; um agente com a chave leria senhas.
- Nenhuma exibição em tela, só leitura direta no banco: descartada; o admin precisa consultar pelo painel.
- Verificação em duas etapas obrigatória para admin e gerente (recomendada) ou opcional para todos: descartadas pelo usuário; ficou só o limite de tentativas.

## Consequências

- Risco aceito: um vazamento do banco ou de um backup expõe todas as senhas, inclusive as reutilizadas pelos usuários em outros serviços.
- Risco aceito: sem segunda etapa, a senha do admin é a única barreira do painel que exibe as senhas dos alunos.
- Dumps de backup contêm senhas em texto; ficam fora do Git e a guarda deles é responsabilidade de quem instala (ver [033](../033-observabilidade-retencao-backup.md)).
- Os logs precisam de filtro explícito de campos sensíveis, coberto por teste (ver [007](../007-contas-e-autenticacao.md) e [028](../028-auditoria.md)).
- A exportação de dados da LGPD não inclui a senha (ver [030](../030-lgpd.md)).
- É a primeira ameaça listada no modelo de ameaças do projeto (Q-03).
