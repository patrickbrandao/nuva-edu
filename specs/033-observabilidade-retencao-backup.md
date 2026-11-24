# 033 — Observabilidade, retenção, backup e ameaças

Status: aprovada
Depende de: 001, 003, 004, 005, 028, 031

## Contexto

Uma instalação é operada por uma escola pequena, sem equipe de infraestrutura. O sistema precisa mostrar sozinho o que está falhando, não acumular dados sem necessidade, ter backup que comprovadamente restaura e deixar explícitas as ameaças que o desenho precisa conter — em especial porque as senhas ficam em texto legível no banco.

## Requisitos

- RF-01: Todos os serviços escrevem logs estruturados em JSON na saída padrão.
- RF-02: Cada serviço expõe `/healthz` (vivo) e `/readyz` (pronto para atender).
- RF-03: Cada serviço expõe `/metrics` no formato Prometheus, acessível só na rede interna do Compose.
- RF-04: O site admin tem uma tela "Operação" com fila, e-mails e webhooks com falha, e ações de reprocessar.
- RF-05: Um job diário do worker apaga os dados não vitais vencidos, conforme a tabela de retenção.
- RF-06: O perfil `backup` faz `pg_dump` diário com retenção de 7 diários e 4 semanais e traz um script de restauração.
- RF-07: A cada release, o CI restaura um dump num banco vazio e confere o resultado.
- RF-08: Cada ameaça listada nesta spec tem mitigação implementada e pelo menos um teste automatizado.
- RNF-01: p95 da API abaixo de 300 ms com 500 usuários simultâneos em 2 vCPU e 4 GB (medido por teste de carga antes da versão 1.0).
- RNF-02: Nenhuma linha de log contém senha, valor de chave ou token, CPF/CNPJ, corpo de mensagem direta ou cabeçalho `Authorization`/`Cookie` (teste varre os logs da suíte e2e).
- RNF-03: `/healthz` responde em menos de 50 ms sem tocar no banco; `/readyz` em menos de 500 ms.
- RNF-04: A restauração de um banco de 5 GB termina em menos de 30 minutos.
- RNF-05: O expurgo diário apaga em lotes de 5.000 linhas e não segura transação por mais de 5 s.

## Comportamento

### Logs

- Formato JSON, uma linha por evento, com `time`, `level`, `service`, `msg`, `request_id` e, quando houver, `user_id`, `route`, `status`, `duration_ms`, `job_id`.
- O `request_id` nasce no Traefik (ou na API, se ausente), volta ao cliente em `X-Request-Id` e acompanha as tarefas que a requisição enfileira.
- Nível por `NUVA_LOG_LEVEL` (`info` por padrão). Erros incluem a pilha.
- Lista de campos sempre mascarados: `password`, `token`, `secret`, `authorization`, `cookie`, `cpf`, `cnpj`, `document`, `key`.
- Os logs ficam no Docker com rotação de 10 MB x 5 arquivos; não há agregador embutido.

### Saúde

| Rota | Verifica | Uso |
| --- | --- | --- |
| `/healthz` | Processo responde | `healthcheck` do Docker; roteada pelo Traefik para conferência externa |
| `/readyz` | Conexão com o banco, migrations na versão esperada, e (worker) laço da fila ativo | `depends_on` e diagnóstico; não roteada |

API com migrations desatualizadas fica "não pronta" e registra o motivo.

### Métricas

Sem identificadores de usuário nos rótulos.

| Métrica | Tipo | Serviço |
| --- | --- | --- |
| `http_requests_total{route,method,status}` | contador | APIs |
| `http_request_duration_seconds{route,method}` | histograma | APIs |
| `sse_connections` | medidor | `classroom-api`, `admin-api` |
| `db_pool_connections{state}` | medidor | todos |
| `jobs_total{type,outcome}` | contador | worker |
| `jobs_queue_depth{type}` | medidor | worker |
| `jobs_oldest_pending_seconds` | medidor | worker |
| `emails_total{outcome}` | contador | worker |
| `webhooks_total{provider,outcome}` | contador | `classroom-api` |
| `login_attempts_total{outcome}` | contador | APIs |
| `mcp_tool_calls_total{tool,outcome}` | contador | `admin-api` |
| `images_bytes_total` | medidor | worker |

Não há tracing distribuído nem alertas embutidos. O guia em `docs/` traz um exemplo de coleta com Prometheus e três alertas sugeridos (fila parada, taxa de erro 5xx, backup atrasado).

### Tela "Operação" (admin e gerente)

- **Fila**: pendentes, em execução e com falha por tipo; idade da tarefa mais antiga; ação "tentar de novo" e "descartar" nas com falha.
- **E-mails**: pendentes e com falha, com destinatário mascarado, assunto e último erro do SMTP; "reenviar".
- **Webhooks**: recebidos com falha de assinatura ou de processamento; "reprocessar".
- **Sistema**: versão, versão das migrations, tamanho do banco, espaço ocupado por imagens ([029](029-imagens.md)), data do último backup e do último expurgo.
- Um selo no menu do admin indica quando há falhas; não há envio de alerta para fora.

### Retenção

Expurgo diário às 03:30 (fuso da escola, `settings.timezone`), tarefa `retention.purge` do worker ([005](005-worker-e-fila.md)).

| Dado | Prazo padrão | Variável |
| --- | --- | --- |
| Sessão sem uso | 30 dias | `NUVA_RETENTION_SESSION_DAYS` |
| Links de confirmação e de redefinição | 24 horas | `NUVA_RETENTION_EMAIL_TOKEN_HOURS` |
| Tentativas de login | 30 dias | `NUVA_RETENTION_LOGIN_ATTEMPT_DAYS` |
| Tarefas concluídas da fila | 7 dias | `NUVA_RETENTION_JOB_DONE_DAYS` |
| Tarefas com falha | 30 dias | `NUVA_RETENTION_JOB_FAILED_DAYS` |
| Notificações lidas | 90 dias | `NUVA_RETENTION_NOTIFICATION_DAYS` |
| Notificações não lidas | 180 dias | `NUVA_RETENTION_NOTIFICATION_UNREAD_DAYS` |
| E-mails enviados (`email_outbox`) | 30 dias | `NUVA_RETENTION_EMAIL_SENT_DAYS` |
| E-mails com falha (`email_outbox`) | 90 dias | `NUVA_RETENTION_EMAIL_FAILED_DAYS` |
| Denúncias resolvidas, ações de moderação e suspensões | 2 anos (730 dias) | `NUVA_RETENTION_MODERATION_DAYS` |
| Visualizações de case (`case_views`) | 90 dias | fixo |
| Webhooks recebidos | 90 dias | `NUVA_RETENTION_WEBHOOK_DAYS` |
| Auditoria | 2 anos (730 dias) | `NUVA_RETENTION_AUDIT_DAYS` |
| Chaves MCP revogadas ou expiradas | 2 anos | acompanha a auditoria |
| Exportações de dados (LGPD) | 24 horas | fixo |
| Imagens sem referência | 24 horas | fixo |
| Carrinhos abandonados | 30 dias | `NUVA_RETENTION_CART_DAYS` |
| Registros de venda | 5 anos, depois anonimizados | `NUVA_RETENTION_FISCAL_YEARS` ([030](030-lgpd.md)) |
| Logs dos contêineres | 10 MB x 5 arquivos | configuração do Compose |

Esta tabela é a lista completa e única de prazos; as demais specs usam estes números. Conteúdo de fórum, mensagens, progresso e compras não expiram. O cookie de sessão é o único cookie e segue o prazo da sessão.

### Backup e restauração

- Contêiner `backup` (perfil `backup`), definido em `database/postgres/docker-compose.yml`.
- `pg_dump` em formato personalizado (`-Fc`), diário às 02:30 (`NUVA_BACKUP_CRON`), gravado no volume `backup-data` (ou na pasta de `NUVA_BACKUP_DIR`).
- Nome: `nuva-edu-AAAA-MM-DD.dump`, com arquivo `.sha256` ao lado.
- Retenção: 7 diários e 4 semanais (o de domingo), ajustável por `NUVA_BACKUP_KEEP_DAILY` e `NUVA_BACKUP_KEEP_WEEKLY`.
- Cada execução grava data, tamanho e resultado numa tabela lida pela tela "Operação"; backup com mais de 26 horas aparece como atrasado.
- `scripts/backup.sh` faz um dump sob demanda; `scripts/restore.sh <arquivo>` confere o `.sha256`, exige confirmação digitada, para as APIs e o worker, restaura num banco novo, troca os bancos e sobe tudo de novo.
- O dump contém as senhas em texto legível: o guia manda guardá-lo cifrado e com acesso restrito. Copiar os dumps para fora do servidor é responsabilidade de quem instala, com exemplo no guia.
- Teste de restauração no CI (fluxo `release`): popula um banco com dados de exemplo, faz o dump, restaura num banco vazio e compara contagem de linhas e somas de verificação de tabelas-chave (`users`, `orders`, `entitlements`, `image_variants`).

### Ameaças principais

| # | Ameaça | Mitigação | Teste |
| --- | --- | --- | --- |
| 1 | Vazamento do banco ou de um dump expõe senhas em texto | Postgres sem porta publicada fora do desenvolvimento; usuário de banco próprio da aplicação; `password` fora de toda resposta de API, MCP, log e exportação; exibição só ao `admin`, auditada; orientação de cifrar backups; aviso no cadastro para não reutilizar senha de outros serviços | Varredura das respostas de todas as rotas e ferramentas por `password`; varredura dos logs da suíte e2e |
| 2 | Tomada de conta por força bruta ou por vínculo social indevido | 5 erros = 15 min de bloqueio por conta e por IP; comparação em tempo constante; senha vazia nunca autentica; aviso por e-mail de login em dispositivo novo; vínculo social só com e-mail verificado pelo provedor; conta por senha só compra ou posta após confirmar o e-mail | Bloqueio na 6ª tentativa; login com senha vazia em conta social recusado; provedor com e-mail não verificado não une contas |
| 3 | Webhook de pagamento forjado ou repetido | Validação da assinatura com `MP_WEBHOOK_SECRET`; processamento idempotente por identificador do evento; estado conferido na API do Mercado Pago antes de liberar acesso; reconciliação periódica | Webhook sem assinatura válida é recusado; o mesmo evento duas vezes libera um único direito |
| 4 | Elevação de privilégio entre papéis ou por chave MCP | Autorização central em `packages/core`, usada pelas duas APIs e pelo MCP; papel lido do banco a cada requisição; chave MCP usa o papel atual do emissor; `instructor` restrito aos próprios cursos; último `admin` não pode ser rebaixado | Matriz de permissões testada rota a rota e ferramenta a ferramenta para os quatro papéis |
| 5 | XSS em conteúdo de aluno (fórum, cases, mensagens, perfil) | Markdown convertido com lista de permissão de marcações e saneado no servidor e no navegador; sem HTML bruto; links com `rel="noopener nofollow"`; Content-Security-Policy sem `unsafe-inline` para scripts; cookie `HttpOnly`, `Secure`, `SameSite=Lax`; imagens regravadas ([029](029-imagens.md)) | Conjunto de cargas de XSS conhecidas publicadas em cada campo e conferidas como inertes no e2e |
| 6 | Acesso a aula ou ebook sem direito | Links de vídeo, arquivo e ebook só saem da API depois da checagem de direito ([010](010-direitos-de-acesso.md)); o programa do curso não traz os links; reembolso e fim de plano revogam em cascata | Usuário sem direito recebe 403 e nenhuma resposta contém o link; revogação testada após reembolso |

Proteções gerais que valem para todas: cabeçalhos de segurança (HSTS quando em HTTPS, `X-Content-Type-Options`, `Referrer-Policy`), proteção contra CSRF nas rotas com cookie (verificação de `Origin` e `SameSite`), limite de requisições por IP nas rotas públicas (120 por minuto) e de tamanho de corpo (1 MB, exceto envio de imagem).

### Teste de carga

Antes da versão 1.0 (Fase 7 do plano), um roteiro k6 simula 500 usuários simultâneos (navegar vitrine, assistir aula, marcar progresso, ler e responder fórum, manter SSE aberto) por 15 minutos numa máquina de 2 vCPU e 4 GB, e precisa cumprir a RNF-01 com taxa de erro abaixo de 0,1%.

## Interfaces e contratos

- `/healthz`, `/readyz`, `/metrics` em cada serviço (fora do OpenAPI público; descritos aqui).
- Em `apps/admin-api/openapi.yaml`: `GET /api/v1/ops/summary`, `GET /api/v1/ops/jobs`, `POST /api/v1/ops/jobs/{id}/retry`, `DELETE /api/v1/ops/jobs/{id}`, `GET /api/v1/ops/emails`, `POST /api/v1/ops/emails/{id}/retry`, `GET /api/v1/ops/webhooks`, `POST /api/v1/ops/webhooks/{id}/reprocess`.
- Variáveis de backup: `NUVA_BACKUP_CRON` (`30 2 * * *`), `NUVA_BACKUP_DIR` (vazio = volume), `NUVA_BACKUP_KEEP_DAILY` (`7`), `NUVA_BACKUP_KEEP_WEEKLY` (`4`).
- Scripts: `scripts/backup.sh`, `scripts/restore.sh`.

## Dados

- `jobs`, `webhook_events`: lidos pela tela "Operação"; dono, o worker e a `classroom-api`.
- `backup_runs` (`started_at`, `finished_at`, `file`, `bytes`, `outcome`, `error`): escrita pelo contêiner `backup`.
- `retention_runs` (`ran_at`, linhas apagadas por tabela): escrita pelo worker.
- Dumps no volume `backup-data`.

## Critérios de aceite

- [ ] Toda linha de log das APIs e do worker é JSON válido com `request_id` quando originada de requisição.
- [ ] A varredura dos logs da suíte e2e não encontra nenhum campo da lista de mascarados com valor.
- [ ] `/metrics` não responde pela URL pública.
- [ ] Parar o Postgres deixa `/readyz` em falha e `/healthz` em sucesso.
- [ ] Um e-mail que falha no SMTP aparece na tela "Operação" e é reenviado pelo botão.
- [ ] Após o expurgo, não restam sessões com mais de 30 dias sem uso nem tarefas concluídas com mais de 7 dias; notificações não lidas permanecem.
- [ ] Com 12 dias de backups, restam 7 diários e os semanais devidos.
- [ ] `scripts/restore.sh` recusa um dump com soma de verificação divergente.
- [ ] O fluxo `release` do CI falha se a restauração divergir do original.
- [ ] Cada linha da tabela de ameaças tem o teste indicado na suíte.
- [ ] O teste de carga cumpre p95 < 300 ms e erro < 0,1% com 500 simultâneos.

## Fora de escopo

- Tracing distribuído e OpenTelemetry.
- Alertas embutidos (e-mail, Slack) e painel de métricas pronto.
- Envio automático de backup para armazenamento externo e cifragem do dump pelo próprio sistema.
- Recuperação a um ponto no tempo (arquivamento de WAL) e réplica do banco.
- Verificação em duas etapas (decisão registrada em [0011](decisions/0011-autenticacao-sessao-e-vinculo-social.md)).

## Decisões relacionadas

- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0011 — Autenticação: sessão e vínculo social](decisions/0011-autenticacao-sessao-e-vinculo-social.md)
- [0008 — Fila e SSE no PostgreSQL (provisória)](decisions/0008-fila-e-sse-no-postgres.md)
- [0007 — Imagens no PostgreSQL (provisória)](decisions/0007-imagens-no-postgres.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
