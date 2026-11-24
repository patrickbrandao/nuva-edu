# 028 — Auditoria

Status: aprovada
Depende de: 001, 003, 008

## Contexto

A equipe tem poderes amplos (inclusive ver senhas, no caso do admin) e agentes de IA agem pela escola via MCP. O registro de auditoria responde "quem fez o quê, quando e por onde" e não pode ser alterado por ninguém pela aplicação.

## Requisitos

- RF-01: Toda ação de escrita feita por `instructor`, `manager` ou `admin` na `admin-api` gera um registro em `audit_log`.
- RF-02: Toda chamada de ferramenta do MCP gera um registro, inclusive as de leitura, com a chave usada.
- RF-03: Leituras sensíveis feitas pelo painel também são registradas: visualização de senha, exportação de vendas em CSV, exportação de dados de um usuário, consulta à própria auditoria.
- RF-04: Eventos de segurança de qualquer conta são registrados: login, falha de login com bloqueio, troca de senha, vínculo e desvínculo de provedor, exclusão de conta.
- RF-05: O registro é imutável: a aplicação só insere. Não há rota, ferramenta ou comando que altere ou apague um registro individual.
- RF-06: O `admin` consulta a auditoria no site admin, com filtros por período, ator, ação, alvo, origem e chave MCP. Só o `admin`: a matriz de [008](008-papeis-e-permissoes.md) (`audit.view`) é a referência única.
- RF-07: O registro nunca contém senha, valor de chave, token ou segredo; campos sensíveis alterados aparecem como `"[alterado]"`.
- RNF-01: Retenção de 2 anos (`NUVA_RETENTION_AUDIT_DAYS`, padrão 730); o expurgo diário do worker apaga o que passar disso.
- RNF-02: A gravação do registro acontece na mesma transação da ação; se o registro falhar, a ação falha.
- RNF-03: Consulta filtrada por período de 30 dias responde em menos de 500 ms (p95) com 5 milhões de registros.

## Comportamento

### O que é registrado

| Grupo | Ações (`action`) |
| --- | --- |
| Contas | `user.create`, `user.update`, `user.suspend`, `user.unsuspend`, `user.set_role`, `user.delete`, `user.password_view`, `user.password_set`, `user.export` |
| Sessão e login | `auth.login`, `auth.logout`, `auth.lockout`, `auth.password_reset`, `auth.provider_link`, `auth.provider_unlink` |
| Catálogo | `course.*`, `module.*`, `lesson.*`, `ebook.*`, `bundle.*` (`create`, `update`, `delete`, `publish`, `unpublish`), `product.set_price` |
| Vendas | `plan.*`, `coupon.*`, `order.refund`, `sales.export` |
| Acessos | `entitlement.grant`, `entitlement.revoke` |
| Comunidade | `forum.post_hide`, `forum.post_edit`, `forum.topic_close`, `forum.topic_pin`, `forum.category.*`, `case.hide`, `report.resolve`, `badge.award`, `points.adjust` |
| Suporte | `ticket.reply`, `ticket.set_status` |
| Conteúdo da escola | `event.*`, `announcement.*` |
| Configuração | `settings.update`, `terms.publish` |
| MCP | `mcp_key.create`, `mcp_key.revoke`, `mcp.tool_call` |
| Auditoria | `audit.search` |

### Regras

- `actor_user_id` é quem agiu. Em chamada MCP é o emissor da chave, com `mcp_key_id` preenchido e `origin = mcp`.
- `origin`: `admin_panel`, `mcp`, `classroom`, `worker`, `cli`.
- `details` guarda o antes e o depois dos campos alterados, limitado a 8 KB; acima disso é truncado e marcado com `truncated: true`.
- Em `mcp.tool_call`, `details` traz o nome da ferramenta, os argumentos (com campos sensíveis mascarados) e o resultado (`ok` ou o código do erro), sem o corpo da resposta.
- `ip` é o IP real do cliente, obtido conforme `TRUSTED_PROXIES` ([031](031-infraestrutura-e-deploy.md)).
- Ação recusada por falta de permissão também é registrada, com `outcome = denied`.
- A exclusão de conta ([030](030-lgpd.md)) não apaga registros: o ator ou alvo excluído passa a aparecer como "usuário removido", e o `ip` desses registros é apagado.

### Imutabilidade

As aplicações e as migrations usam hoje o mesmo usuário de banco, dono das tabelas ([031](031-infraestrutura-e-deploy.md)); revogar privilégio do dono não protege nada, porque ele pode concedê-lo de volta. Por isso a imutabilidade é garantida por gatilhos, que valem para qualquer usuário:

- Gatilho `BEFORE UPDATE` (`audit_log_guard_update`): recusa a atualização, exceto quando a única diferença entre a linha antiga e a nova é `ip` e `user_agent` passando a nulo (a anonimização da exclusão de conta, [030](030-lgpd.md)). "Usuário removido" não é gravado no registro: vem de `users.deleted_at` na leitura.
- Gatilho `BEFORE DELETE` (`audit_log_guard_delete`): recusa a exclusão, exceto dentro da função `audit_log_purge(retention_days integer)`, que marca a transação (`SET LOCAL nuva.audit_purge = 'on'`), aceita só `retention_days >= 365`, apaga os registros mais antigos que o prazo em lotes e devolve quantos apagou. O worker chama essa função no expurgo diário.
- Gatilho `BEFORE TRUNCATE`: sempre recusa.
- Erro dos gatilhos: `SQLSTATE` `P0001` com a mensagem `audit_log é imutável`.
- Limite conhecido: quem tem acesso SQL com o usuário dono pode desligar os gatilhos. Um usuário de banco só da aplicação, com `INSERT` e `SELECT` em `audit_log`, entra com a revisão de ameaças da Fase 7 ([033](033-observabilidade-retencao-backup.md), ameaça 1).

### Gravação

- Função `recordAudit(trx, entry)` de `packages/core` (módulo `audit`), sempre na transação da ação (RNF-02). `request_id`, `ip` e `user_agent` vêm do contexto da requisição.
- A redação de `details` é feita por ela, não por quem chama: chaves `password`, `adminPassword`, `currentPassword`, `newPassword`, `token`, `csrfToken`, `secret` e as terminadas em `Password`, `Token` ou `Secret` viram `"[alterado]"`, em qualquer profundidade.
- Negação por permissão na `admin-api` (`outcome = denied`) é gravada pela base da API, fora da transação da ação (que não chega a existir), com a ação do contrato (`x-permission`) em `details.permission`.

### Consulta

- `GET /api/v1/audit` filtra por `from` e `to` (padrão: últimos 30 dias; janela máxima de 366 dias), `actorId`, `action` (exata ou prefixo com `.*`, como `user.*`), `targetType`, `targetId`, `origin`, `mcpKeyId`, `outcome`, com paginação por cursor e ordem do mais novo para o mais antigo. Cada item traz o registro sem `details` e o nome do ator e do alvo, quando são usuários (`"usuário removido"` se excluído).
- `GET /api/v1/audit/{id}` traz o registro com `details`.
- A própria consulta gera `audit.search` (com os filtros em `details`), uma por chamada de lista ou de exportação; abrir um registro não gera nada.

## Interfaces e contratos

Em `apps/admin-api/openapi.yaml`:

- `GET /api/v1/audit` — lista paginada por cursor, com os filtros de RF-06.
- `GET /api/v1/audit/{id}` — um registro com `details`.
- `GET /api/v1/audit/export` — CSV do filtro atual, só `admin`, limitado a 100.000 linhas. Entra na Fase 5, com o MCP; a Fase 1 traz a lista e o registro.

Ferramenta MCP `audit_search` ([027](027-mcp.md)), com os mesmos filtros.

## Dados

Tabela `audit_log`, de propriedade da `admin-api` (a `classroom-api` e o `worker` inserem eventos de segurança pela função de `packages/core`):

| Campo | Descrição |
| --- | --- |
| `id` | UUID v7 (ordenável por tempo) |
| `created_at` | Momento da ação |
| `actor_user_id` | Quem agiu; nulo para `worker` e `cli` |
| `actor_role` | Papel do ator no momento |
| `origin` | Ver regras |
| `mcp_key_id` | Chave usada, se houver |
| `action` | Código da ação |
| `target_type`, `target_id` | Alvo |
| `outcome` | `ok`, `denied`, `error` |
| `ip`, `user_agent` | Origem da requisição |
| `request_id` | Mesmo identificador dos logs |
| `details` | JSON com antes e depois |

Índices: `(created_at)`, `(actor_user_id, created_at)`, `(target_type, target_id, created_at)`, `(action, created_at)`, `(mcp_key_id, created_at)`.

Decisões de esquema da migration 0006 (aceitas na tarefa 198):

- `target_id` é `text`: o alvo pode ser um UUID ou uma chave (como em `settings.update`).
- `actor_user_id` tem chave estrangeira para `users` (a linha de `users` nunca é apagada, [030](030-lgpd.md)). `mcp_key_id` fica sem chave estrangeira até a Fase 5, quando a migration de `mcp_keys` a acrescenta.
- O índice de ação é `(action text_pattern_ops, created_at)`: o banco usa colação `en_US`, e o filtro por prefixo (`user.*` vira `action LIKE 'user.%'`) só usa índice assim; a igualdade também o usa.
- `action` precisa ter ao menos um ponto, em minúsculas: `CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')`. Toda ação do catálogo acima já segue esse formato; ação nova também.
- O limite de 8 KB de `details` e a marca `truncated` são da `recordAudit`; o banco não repete o limite, para não desfazer uma ação por diferença de medida. O banco só exige que `details` seja um objeto.
- O gatilho de `DELETE`, além da marca `nuva.audit_purge` da transação, exige que a linha tenha mais de 365 dias, e `audit_log_purge` desliga a marca ao terminar: nem um `SET LOCAL` avulso apaga registro recente.
- `audit_log_purge` com `retention_days` nulo ou abaixo de 365 falha com `SQLSTATE` `22023` (`invalid_parameter_value`), distinto do `P0001` dos gatilhos.

## Critérios de aceite

- [ ] Cada rota de escrita da `admin-api` tem teste que confere o registro gerado.
- [ ] Ver a senha de um usuário gera `user.password_view` com ator, alvo e IP.
- [ ] Chamada MCP gera `mcp.tool_call` com `mcp_key_id` e sem valores sensíveis em `details`.
- [ ] `UPDATE`, `DELETE` e `TRUNCATE` diretos em `audit_log` são recusados pelo banco; `audit_log_purge(30)` é recusada; a anonimização de `ip` e `user_agent` é aceita.
- [ ] Ação que falha ao gravar a auditoria é desfeita (mesma transação).
- [ ] O `manager` recebe `403` na consulta à auditoria; o `admin` vê `user.password_view` com ator, alvo e IP.
- [ ] O expurgo apaga registros com mais de 730 dias e nenhum mais novo.

## Fora de escopo

- Envio da auditoria para sistemas externos (SIEM, syslog).
- Assinatura criptográfica ou encadeamento de hashes dos registros.
- Auditoria de leituras comuns do painel (listar cursos, abrir um chamado).

## Decisões relacionadas

- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0012 — Chaves MCP herdam o papel do emissor](decisions/0012-mcp-chaves-herdam-papel.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
