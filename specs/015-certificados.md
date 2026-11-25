# 015 — Certificados

Status: aprovada
Depende de: 000, 001, 005, 009, 014

## Contexto

O certificado de conclusão é argumento de venda e prova para o aluno. Ao concluir 100% das aulas de um curso, o aluno recebe um PDF com nome, curso, carga horária e um código. Qualquer pessoa confere a autenticidade numa página pública, sem login.

Não há provas no MVP: a única regra é concluir todas as aulas ([014](014-aprendizado-e-progresso.md)).

## Requisitos

- RF-01: Emitir o certificado automaticamente quando o aluno conclui 100% das aulas publicadas de um curso com certificado habilitado.
- RF-02: O certificado é um PDF com nome do aluno, título do curso, carga horária, data de conclusão, nome da escola e código de validação.
- RF-03: Página pública de validação por código, sem login.
- RF-04: O aluno baixa seus certificados na estante e na página do curso.
- RF-05: O admin habilita ou desabilita o certificado por curso e define os dados de emissão da escola.
- RF-06: Só o admin revoga um certificado, com motivo ([008](008-papeis-e-permissoes.md)); a validação passa a indicar a revogação.
- RF-07: Admin e gerente emitem manualmente um certificado para um aluno, com motivo.
- RF-08: Um certificado por aluno e curso; emitir de novo devolve o existente.
- RNF-01: Certificado disponível em até 60 s após a conclusão (p95).
- RNF-02: Página de validação em p95 < 300 ms.
- RNF-03: PDF de uma página A4 paisagem, com no máximo 300 KB.
- RNF-04: Código com 12 caracteres de um alfabeto sem ambiguidades (sem `0`, `O`, `1`, `I`, `L`), gerado com aleatoriedade criptográfica; formato `XXXX-XXXX-XXXX`.
- RNF-05: Validação limitada a 30 consultas por minuto por IP.

## Comportamento

### Emissão

1. Ao atingir 100%, o `classroom-api` enfileira `course.completed` ([014](014-aprendizado-e-progresso.md)).
2. O worker confere, na hora da emissão, que: o curso tem `certificate_enabled`; o aluno tem 100% das aulas publicadas concluídas; ainda não existe certificado para (usuário, curso).
3. Cria o registro em `certificates` com os dados congelados (nome, título do curso, carga horária, data, escola) e o código.
4. Gera o PDF e o guarda no registro.
5. Notifica o aluno e envia e-mail com o link ([024](024-notificacoes-e-email.md)); credita os pontos ([020](020-gamificacao.md)).

Regras:

- Dados congelados: mudança posterior no nome do aluno, no título ou nas aulas do curso não altera certificado já emitido.
- Nome no certificado: `users.full_name`; se vazio, o nome de exibição. Antes da primeira emissão, o classroom pede ao aluno que confirme o nome completo; sem confirmação em 7 dias, emite com o nome disponível.
- Corrigir o nome: o aluno pede por chamado; admin ou gerente usam "reemitir", que regenera o PDF com o nome atual, mantém o código e registra auditoria.
- Carga horária: soma de `duration_seconds` das aulas publicadas no momento da emissão, arredondada para cima em horas inteiras; o admin pode fixar outro valor por curso (`certificate_hours`).
- Data de conclusão: a da última aula concluída.
- Curso `open` também emite certificado, se habilitado.
- Aula amostra concluída sem o curso não conta; a emissão exige que o aluno tenha tido acesso ao curso.
- Perder o acesso depois (reembolso, fim de plano) não revoga o certificado automaticamente; a revogação é decisão manual. Em reembolso dentro de 7 dias da compra, a tela de reembolso oferece a caixa "revogar certificados deste curso", marcada por padrão.
- Curso concluído antes de o certificado ser habilitado: ao habilitar, o admin escolhe emitir para quem já concluiu (tarefa em lote) ou só para conclusões futuras.

### PDF

- Gerado no worker, sem depender de serviço externo e sem navegador embutido.
- Conteúdo: logotipo (quando `school.logo_image_id` existe; sem ele, só o nome) e nome da escola, título "Certificado de conclusão", nome do aluno, texto "concluiu o curso <título>, com carga horária de <N> horas, em <data por extenso>", nome e cargo de quem assina (texto), código de validação, endereço da página de validação e código QR apontando para ela.
- Modelo único no MVP; cores e logotipo vêm das configurações da escola (`settings`).
- Idioma do `NUVA_LOCALE`.
- Guardado em `certificates.pdf` (bytea); com 300 KB por certificado, 10.000 certificados ocupam cerca de 3 GB, dentro do gatilho de revisão de [0007](decisions/0007-imagens-no-postgres.md). Regenerável a partir dos dados congelados.

### Validação pública

- Endereço: `https://<NUVA_CLASSROOM_HOST>/certificados/<código>` (a rota do classroom em [006](006-sites-e-interface.md)), impresso no PDF e no código QR; há também um formulário para digitar o código, em `/certificados`.
- Código aceito com ou sem hífens e sem diferenciar maiúsculas.
- Certificado válido: mostra nome do aluno, curso, carga horária, data de conclusão, data de emissão e escola.
- Certificado revogado: mostra "certificado revogado" e a data, sem o motivo.
- Titular que excluiu a conta: mostra o código, o curso e a data, com o aviso "titular removeu a conta", sem o nome ([030](030-lgpd.md)).
- Código inexistente: mostra "certificado não encontrado", com a mesma resposta e o mesmo tempo para qualquer código inválido.
- A página não expõe e-mail, foto nem link para o perfil do aluno.
- O PDF só é baixado pelo dono (logado) e pela equipe; a página pública não oferece o arquivo.

### Revogação e emissão manual

- Revogar: só o admin, com motivo obrigatório; grava `revoked_at`; o aluno é notificado. Desfazer a revogação: só o admin.
- Emissão manual: admin ou gerente emitem para um aluno que não concluiu pelo sistema (por exemplo, turma migrada), com motivo; marca `issued_manually`.
- Ambas gravam auditoria ([028](028-auditoria.md)) e estão no MCP ([027](027-mcp.md)).

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Baixar certificado de outro aluno | `404` |
| Curso com certificado desabilitado | nenhuma emissão; a página do curso não menciona certificado |
| Falha ao gerar o PDF | a tarefa repete (até 5 vezes, [005](005-worker-e-fila.md)); o registro existe e a validação já funciona; o download mostra "em preparação" |
| Mais de 30 validações por minuto do mesmo IP | `429` |
| Emissão manual para quem já tem certificado do curso | `409` |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /me/certificates`
- `GET /me/certificates/{id}/pdf`
- `PUT /me/certificate-name` (confirma o nome completo)
- `GET /certificates/verify/{code}` (público)

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET /certificates` (filtros por curso, aluno, estado)
- `POST /certificates` (emissão manual), `POST /certificates/{id}/revoke`, `POST /certificates/{id}/restore` (admin), `POST /certificates/{id}/reissue`
- `PATCH /courses/{id}` com `certificate_enabled` e `certificate_hours`
- `POST /courses/{id}/certificates/backfill`
- `GET|PUT /settings/certificates`: grava `certificate.signer_name` e `certificate.signer_role` ([031](031-infraestrutura-e-deploy.md), "Configurações da escola") e devolve também, só para leitura, o nome, o logotipo e a cor da escola (`school.*`), que são gravados pela identidade da escola (`/settings/branding`, [024](024-notificacoes-e-email.md)). `settings.manage` (admin).

Permissões ([008](008-papeis-e-permissoes.md)): listar e ver, `progress.view` (instrutor só nos próprios cursos); emissão manual e reemissão, `certificate.issue`; revogar e desfazer, `certificate.revoke`; `PATCH /courses/{id}` e `backfill`, `course.edit`.

Tarefas da fila: `course.completed`, `certificate.render`, `certificate.backfill` ([005](005-worker-e-fila.md)).

## Dados

Dono (escrita): `worker` para emissão e PDF; `admin-api` para revogação, emissão manual e configurações.

`certificates`:

| Campo | Descrição |
| --- | --- |
| `id` | UUID v7 |
| `user_id`, `course_id` | únicos em conjunto |
| `code` | único, 12 caracteres |
| `student_name`, `course_title`, `hours`, `completed_at`, `school_name`, `signer_name`, `signer_role` | dados congelados |
| `issued_at`, `issued_manually`, `issued_by`, `issue_reason` | emissão |
| `revoked_at`, `revoked_by`, `revoke_reason` | revogação |
| `pdf`, `pdf_rendered_at` | arquivo e data da geração |

Campos em `courses`: `certificate_enabled` (padrão verdadeiro), `certificate_hours` (nulo = calculado).

Retenção: certificados são permanentes enquanto a conta existir. Na exclusão da conta ([030](030-lgpd.md)) o registro permanece sem o nome do titular e o PDF é apagado: a página de validação mostra o código, o curso e a data, com o aviso "titular removeu a conta", e o PDF deixa de ser servido. O aluno é informado disso antes de confirmar a exclusão.

### Entrega por fase

- Fase 2: tudo acima, com o aviso ao aluno só por e-mail (`certificate.issued`, por `enqueueEmail`, [024](024-notificacoes-e-email.md)).
- Fase 3: a caixa "revogar certificados deste curso" na tela de reembolso ([011](011-vendas-e-checkout.md)).
- Fase 4: notificação na central; pedido de correção do nome por chamado ([023](023-chamados-de-suporte.md)). Até lá a equipe usa "reemitir" a pedido do aluno.
- Fase 6: pontos da conclusão ([020](020-gamificacao.md)).

## Critérios de aceite

- [ ] Concluir a última aula gera o certificado em até 60 s, com notificação e e-mail.
- [ ] Duas tarefas `course.completed` simultâneas geram um único certificado.
- [ ] O PDF traz todos os campos, o código e o QR, e tem até 300 KB.
- [ ] A página pública valida o código com e sem hífens e em minúsculas.
- [ ] Código inexistente e código revogado mostram as mensagens próprias, sem dados além dos previstos.
- [ ] Renomear o curso depois não altera o certificado emitido.
- [ ] "Reemitir" mantém o código e atualiza o nome.
- [ ] Aluno não baixa o PDF de outro aluno (`404`).
- [ ] 31ª validação no mesmo minuto responde `429`.
- [ ] Curso com certificado desabilitado não emite.
- [ ] Emissão manual e revogação aparecem na auditoria.

## Fora de escopo

- Provas, nota mínima e frequência como condição.
- Vários modelos de certificado e editor visual.
- Assinatura digital com certificado ICP-Brasil.
- Certificado de pacote ou de trilha.
- Envio automático a redes profissionais.

## Decisões relacionadas

- [0017](decisions/0017-escopo-do-mvp.md)
- [0007](decisions/0007-imagens-no-postgres.md)
- [0001](decisions/0001-decisoes-iniciais.md)
