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
- RF-06: `admin` e `manager` consultam a auditoria no site admin, com filtros por período, ator, ação, alvo, origem e chave MCP. O `manager` não vê registros cuja ação seja exclusiva de `admin`.
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

- O usuário de banco das aplicações tem apenas `INSERT` e `SELECT` em `audit_log`.
- O expurgo por retenção é feito por uma função do banco (`SECURITY DEFINER`) que só aceita apagar registros mais antigos que o prazo mínimo de 365 dias; o worker chama essa função.
- Um gatilho recusa `UPDATE` em qualquer linha, exceto a anonimização de `ip` e de rótulos de usuário feita pela função de exclusão de conta.

## Interfaces e contratos

Em `apps/admin-api/openapi.yaml`:

- `GET /api/v1/audit` — lista paginada por cursor, com os filtros de RF-06.
- `GET /api/v1/audit/{id}` — um registro com `details`.
- `GET /api/v1/audit/export` — CSV do filtro atual, só `admin`, limitado a 100.000 linhas.

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

## Critérios de aceite

- [ ] Cada rota de escrita da `admin-api` tem teste que confere o registro gerado.
- [ ] Ver a senha de um usuário gera `user.password_view` com ator, alvo e IP.
- [ ] Chamada MCP gera `mcp.tool_call` com `mcp_key_id` e sem valores sensíveis em `details`.
- [ ] `UPDATE` e `DELETE` diretos em `audit_log` com o usuário da aplicação são recusados pelo banco.
- [ ] Ação que falha ao gravar a auditoria é desfeita (mesma transação).
- [ ] O `manager` não enxerga `settings.update` nem `order.refund` na consulta.
- [ ] O expurgo apaga registros com mais de 730 dias e nenhum mais novo.

## Fora de escopo

- Envio da auditoria para sistemas externos (SIEM, syslog).
- Assinatura criptográfica ou encadeamento de hashes dos registros.
- Auditoria de leituras comuns do painel (listar cursos, abrir um chamado).

## Decisões relacionadas

- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0012 — Chaves MCP herdam o papel do emissor](decisions/0012-mcp-chaves-herdam-papel.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
