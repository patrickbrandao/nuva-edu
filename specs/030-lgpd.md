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
- RF-09: O banner de cookies não é necessário: o sistema usa apenas o cookie de sessão, estritamente necessário, e nenhuma ferramenta de rastreamento. Isso consta na política.
- RNF-01: A exportação fica pronta em até 10 minutos e o link vale 24 horas.
- RNF-02: A exclusão tem carência de 7 dias (`NUVA_ACCOUNT_DELETION_GRACE_DAYS`), durante a qual o usuário pode cancelar entrando de novo; depois é irreversível.
- RNF-03: Registros de venda são mantidos por 5 anos a partir do pagamento (`NUVA_RETENTION_FISCAL_YEARS`, padrão 5) e então anonimizados por completo.
- RNF-04: No máximo 1 exportação por usuário a cada 24 horas.

## Comportamento

### Termos e aceite

- Dois documentos: `terms` e `privacy`. Cada versão tem número sequencial, texto em Markdown, data de vigência e o indicador `requires_reacceptance`.
- A vitrine exibe as versões vigentes em `/termos` e `/privacidade`, sem login. O conteúdo jurídico é responsabilidade da escola; a instalação nova vem com um modelo marcado como rascunho. O cadastro não é bloqueado enquanto não houver versão publicada: nesse caso não há aceite a registrar, e o admin vê um aviso fixo no painel até publicar a primeira versão. Publicada a primeira versão, quem se cadastrou antes aceita no próximo acesso.
- O histórico de aceites de um usuário é visível para ele e para o admin.

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
| Aceites de termos | Mantidos sem IP nem agente do navegador |
| Auditoria | Mantida; rótulo do usuário trocado e IP apagado ([028](028-auditoria.md)) |

O e-mail liberado pode ser usado em novo cadastro, que será uma conta nova, sem histórico.

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
