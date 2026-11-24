# 030 — LGPD: termos, exportação e exclusão

Status: aprovada
Depende de: 001, 004, 005, 007, 028

## Contexto

Cada instalação trata dados pessoais de alunos brasileiros: nome, e-mail, CPF/CNPJ, histórico de compras e tudo o que o aluno publica. A escola que instala é a controladora; o nuva-edu precisa dar a ela os mecanismos: registro de consentimento, acesso aos próprios dados e exclusão, sem perder os registros que a lei fiscal obriga a manter.

## Requisitos

- RF-01: O admin publica versões dos Termos de Uso e da Política de Privacidade. Cada versão é imutável depois de publicada.
- RF-02: Havendo versão publicada, o cadastro (por senha ou por provedor) só conclui com o aceite das versões vigentes; o aceite registra usuário, versão, data, IP e agente do navegador.
- RF-03: Ao publicar nova versão marcada como "exige novo aceite", o usuário logado é bloqueado numa tela de aceite antes de continuar usando o classroom.
- RF-04: O usuário exporta os próprios dados em JSON pelo perfil.
- RF-05: O usuário exclui a própria conta pelo perfil, com confirmação.
- RF-06: A exclusão anonimiza: apaga os dados pessoais, mantém os registros de venda pelo prazo fiscal e mantém as publicações sem autor identificável.
- RF-07: O admin pode executar exportação e exclusão em nome de um usuário (pedido recebido por chamado), com registro na auditoria.
- RF-08: Publicar um case exige aceite explícito de exibição pública, registrado no próprio case ([022](022-cases.md)).
- RF-09: O banner de cookies não é necessário: o sistema usa apenas cookies estritamente necessários (o de sessão e o de retorno do login social, de 10 minutos; [007](007-contas-e-autenticacao.md), "Cookies") e nenhuma ferramenta de rastreamento. Isso consta na política.
- RNF-01: A exportação fica pronta em até 10 minutos e o link vale 24 horas.
- RNF-02: A exclusão tem carência de 7 dias (`NUVA_ACCOUNT_DELETION_GRACE_DAYS`), durante a qual o usuário pode cancelar entrando de novo; depois é irreversível.
- RNF-03: Registros de venda são mantidos por 5 anos a partir do pagamento (`NUVA_RETENTION_FISCAL_YEARS`, padrão 5) e então anonimizados por completo.
- RNF-04: No máximo 1 exportação por usuário a cada 24 horas.

## Comportamento

### Termos e aceite

- Dois documentos: `terms` e `privacy`. Cada versão tem número sequencial, texto em Markdown, data de vigência e o indicador `requires_reacceptance`.
- A vitrine exibe as versões vigentes em `/termos` e `/privacidade`, sem login. O conteúdo jurídico é responsabilidade da escola; a instalação nova vem com um modelo marcado como rascunho. O cadastro não é bloqueado enquanto não houver versão publicada: nesse caso não há aceite a registrar, e o admin vê um aviso fixo no painel até publicar a primeira versão. Publicada a primeira versão, quem se cadastrou antes aceita no próximo acesso.
- O histórico de aceites de um usuário é visível para ele e para o admin.

### Termos na Fase 1

A Fase 1 entrega o que o cadastro exige; exportação e exclusão ficam para a Fase 7.

| Operação | API | Regra |
| --- | --- | --- |
| `GET /api/v1/terms?document=` | admin | Só `admin` (`settings.manage`). Lista as versões do documento, mais nova primeiro: `id`, `document`, `version`, `status` (`draft` ou `published`), `requiresReacceptance`, `effectiveAt`, `publishedAt`, `createdAt` |
| `POST /api/v1/terms` | admin | Cria um rascunho: `document`, `bodyMd` (1 a 100.000 caracteres), `requiresReacceptance`. O número da versão é dado na publicação |
| `POST /api/v1/terms/{id}/publish` | admin | Publica o rascunho: recebe o próximo `version` do documento, `effective_at = published_at = now()`, vira a vigente e fica imutável. Já publicado: `409` `terms_already_published`. Auditado (`terms.publish`) |
| `GET /api/v1/legal/{document}` | classroom | Público. A vigente: `id`, `document`, `version`, `bodyMd`, `effectiveAt`. Sem versão publicada: `404` |
| `POST /api/v1/me/terms-acceptance` | classroom | `termsVersionIds` (uuid[]): grava um aceite por versão, com IP e navegador. `id` que não é o vigente do documento: `422` `terms_version_outdated`. Aceitar de novo a mesma versão não duplica |

- Rascunho não é editado: para mudar o texto, cria-se outro rascunho. Rascunhos antigos ficam na lista.
- Vigente = a publicada de maior `version` do documento. O esquema `TermsVersion` (sessão, cadastro social) traz `id`, `document`, `version`, `effectiveAt`, sem o texto.
- Pendente para um usuário ([007](007-contas-e-autenticacao.md), "Termos no cadastro e aceite pendente"), por documento, pela **barreira**: a barreira é a versão publicada mais nova entre a versão 1 e as que têm `requires_reacceptance`. O documento fica pendente quando o usuário não aceitou nenhuma versão igual ou posterior à barreira; o que ele aceita para sair da pendência é a vigente. Versão nova sem `requires_reacceptance` não move a barreira: não bloqueia quem já aceitou a barreira ou outra posterior, e não apaga a pendência de quem não aceitou.
  - Exemplo 1: a pessoa se cadastrou antes da v1 e volta depois de uma v2 sem novo aceite. A barreira é a v1; ela não aceitou v1 nem v2, então está pendente e aceita a v2 (a vigente).
  - Exemplo 2: a v2 exige novo aceite e depois sai uma v3 sem novo aceite. A barreira é a v2; quem aceitou só a v1 continua pendente e aceita a v3; quem aceitou a v2 (ou a v3) não está pendente.
- O site admin oferece um texto modelo ao criar a primeira versão de cada documento; o modelo vive no código do site, não no banco.
- Aviso fixo no painel do admin enquanto algum dos dois documentos não tem versão publicada.

### Exportação

A tarefa `account.export` do worker ([005](005-worker-e-fila.md)) gera um arquivo `.zip` com um JSON por área e as imagens do usuário:

| Arquivo | Conteúdo |
| --- | --- |
| `conta.json` | Dados de cadastro, provedores vinculados, aceites de termos, preferências |
| `perfil.json` | Perfil público, seguidores e seguidos |
| `compras.json` | Pedidos, itens, pagamentos, assinaturas, direitos de acesso |
| `aprendizado.json` | Progresso, anotações, certificados |
| `comunidade.json` | Tópicos e respostas do fórum, cases, comentários, reações, pontos e medalhas |
| `mensagens.json` | Mensagens diretas enviadas e recebidas (o outro participante aparece só pelo nome de exibição) |
| `suporte.json` | Chamados e respostas |
| `imagens/` | Avatar, capa e imagens de cases |

- A senha não entra na exportação.
- O arquivo é gravado no banco, entregue por link com token de uso único que exige sessão ativa do próprio usuário, e apagado após 24 horas.
- O usuário é avisado por notificação e e-mail quando estiver pronto.

### Exclusão de conta

1. O usuário confirma digitando o e-mail (contas com senha também informam a senha).
2. A conta entra em `deletion_pending`: sessões encerradas, perfil oculto, assinaturas ativas canceladas no Mercado Pago ([012](012-assinaturas.md)) sem reembolso automático.
3. E-mail de confirmação com o prazo e o modo de cancelar.
4. Após a carência, a tarefa `account.anonymize` do worker executa a anonimização numa transação.

Contas de equipe (`instructor`, `manager`, `admin`) não se excluem sozinhas: o admin precisa antes rebaixá-las a `student`. O último `admin` nunca pode ser excluído.

### O que acontece com cada dado

| Dado | Na exclusão |
| --- | --- |
| Nome, e-mail, senha, telefone, avatar, capa, bio, cidade, links | Apagados; a linha de `users` permanece com `deleted_at` e rótulo "usuário removido" |
| Provedores vinculados, sessões, tokens, tentativas de login | Apagados |
| CPF/CNPJ e nome do comprador nos pedidos | Mantidos pelo prazo fiscal, depois apagados |
| Pedidos, pagamentos, reembolsos (valores e datas) | Mantidos; após o prazo fiscal ficam sem vínculo com pessoa |
| Direitos de acesso, progresso, anotações | Apagados |
| Certificados | O registro permanece sem o nome do titular e o PDF é apagado; a página pública de validação mostra o código, o curso e a data, com o aviso "titular removeu a conta" ([015](015-certificados.md)). O aluno é avisado disso antes de confirmar a exclusão |
| Tópicos, respostas e comentários | Mantidos com autor "usuário removido" |
| Cases e suas imagens | Apagados |
| Mensagens diretas | Mantidas para o outro participante, com remetente "usuário removido" |
| Chamados de suporte | Mantidos com autor "usuário removido"; anexos de imagem apagados |
| Pontos, medalhas, seguidores | Apagados |
| Notificações e preferências | Apagadas |
| Fila de e-mails (`email_outbox`) do usuário | Apagada (o `to` guarda o e-mail) |
| Aceites de termos | Mantidos sem IP nem agente do navegador |
| Auditoria | Mantida; rótulo do usuário trocado e IP apagado ([028](028-auditoria.md)) |

O e-mail liberado pode ser usado em novo cadastro, que será uma conta nova, sem histórico.

Como a linha de `users` é anonimizada (decidido na tarefa 198, sobre a migration 0005):

- `email` e `name` são `NOT NULL` no banco ([007](007-contas-e-autenticacao.md), "Dados"): são substituídos, não anulados. `email` vira `removido-<id>@invalid` (o domínio `.invalid` é reservado e nunca entrega; o `id` mantém o valor único, embora o índice único só valha para contas não excluídas), e `name` vira `usuário removido`. O rótulo exibido continua vindo de `deleted_at` na leitura; o valor gravado só garante que nada do nome original sobra.
- `full_name`, `password`, `email_verified_at`, `tax_id_type` e `tax_id` passam a nulo (o CPF/CNPJ que a lei fiscal exige fica no pedido, não na conta).
- A linha nunca é apagada, então a cascata das tabelas da conta não dispara: `profiles`, `oauth_identities`, `sessions`, `email_tokens`, `user_devices`, `login_attempts` (pelo e-mail) e `email_outbox` são apagadas explicitamente pela `account.anonymize`, na mesma transação.
- As referências de terceiros ao usuário (`user_suspensions.user_id` e `created_by`, `users.suspended_by`, `audit_log.actor_user_id`, `terms_acceptances.user_id`) permanecem e passam a mostrar "usuário removido".

## Interfaces e contratos

Em `apps/classroom-api/openapi.yaml`:

- `GET /api/v1/legal/{document}` — versão vigente (público).
- `POST /api/v1/me/terms-acceptance`
- `POST /api/v1/me/export`, `GET /api/v1/me/export`, `GET /api/v1/me/export/download`
- `POST /api/v1/me/deletion`, `DELETE /api/v1/me/deletion` (cancelar na carência)

Em `apps/admin-api/openapi.yaml`:

- `GET|POST /api/v1/terms`, `POST /api/v1/terms/{id}/publish`
- `POST /api/v1/users/{id}/export`, `POST /api/v1/users/{id}/deletion`

## Dados

| Tabela | Dono | Observação |
| --- | --- | --- |
| `terms_versions` | `admin-api` | `document`, `version`, `body_md`, `effective_at`, `requires_reacceptance`, `published_at` |
| `terms_acceptances` | `classroom-api` | `user_id`, `terms_version_id`, `accepted_at`, `ip`, `user_agent` |
| `data_exports` | `worker` | `user_id`, `status`, `file` (bytea), `token_hash`, `expires_at` |
| `users.deletion_requested_at`, `users.deleted_at` | `classroom-api` pede; `worker` executa | |

Decisões de esquema da migration 0007 (aceitas na tarefa 198):

- Versão publicada (`version` não nulo) é imutável no banco: um gatilho recusa `UPDATE` e também `DELETE` dela (apagá-la alteraria o que foi aceito). Rascunho pode ser publicado ou apagado; a API não oferece hoje a exclusão de rascunho.
- Rascunho não tem `version`, `effective_at` nem `published_at`; publicada tem os três. `version` é único por documento entre as publicadas.
- `terms_acceptances` não confere no banco que a versão aceita é publicada: a regra "vigente" é da `classroom-api` (`terms_version_outdated`), que nunca grava aceite de rascunho.
- As chaves estrangeiras para `users` não têm cascata: a linha de `users` não é apagada e os aceites ficam na exclusão de conta, sem `ip` nem `user_agent`.

## Critérios de aceite

- [ ] Havendo versão publicada, cadastro sem aceite é recusado, por senha e por provedor; sem versão publicada, o cadastro conclui e o admin vê o aviso no painel.
- [ ] Publicar versão com `requires_reacceptance` bloqueia o usuário logado até aceitar.
- [ ] A exportação contém todas as áreas da tabela e não contém a senha.
- [ ] O link de exportação não funciona sem sessão do próprio usuário nem depois de 24 horas.
- [ ] Entrar durante a carência e cancelar restaura a conta intacta.
- [ ] Após a exclusão, uma busca no banco pelo e-mail e pelo nome do usuário só encontra os pedidos dentro do prazo fiscal.
- [ ] Tópicos do usuário excluído aparecem com "usuário removido"; cases e certificados deixam de existir.
- [ ] O último `admin` não consegue excluir a própria conta.
- [ ] Exportação e exclusão feitas pelo admin geram registro em `audit_log`.

## Fora de escopo

- Redação dos termos e da política (conteúdo jurídico é da escola).
- Relatório de impacto, registro de operações de tratamento e canal do encarregado: ficam no guia de `docs/`.
- Consentimento granular para marketing (o sistema não envia e-mail de marketing).
- Anonimização de backups já gravados: o guia orienta o prazo de retenção dos backups.

## Decisões relacionadas

- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
