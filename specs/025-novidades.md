# 025 — Novidades da escola

Status: aprovada
Depende de: 000, 001, 003, 004, 008, 010, 024

## Contexto

A equipe precisa de um lugar para anunciar cursos novos, mudanças e avisos gerais, sem depender do fórum. "Novidades" é um mural de mão única: a equipe publica, o aluno lê, e um contador mostra o que ele ainda não viu.

## Requisitos

- RF-01: `manager` e `admin` criam, editam, agendam, publicam, fixam e despublicam novidades; `instructor` cria novidades restritas aos próprios cursos.
- RF-02: Cada novidade tem título, corpo em Markdown saneado, imagem de capa opcional, público e link de destino opcional.
- RF-03: O aluno vê a lista das novidades do seu público, da mais recente para a mais antiga, com as fixadas no topo.
- RF-04: O menu mostra o contador de novidades não lidas; abrir a lista marca todas as visíveis como lidas.
- RF-05: Publicar pode, à escolha de quem publica, gerar a notificação `announcement.published` ([024](024-notificacoes-e-email.md)).
- RNF-01: Lista (20 itens) e contador com p95 abaixo de 300 ms.
- RNF-02: Título com 5 a 150 caracteres; corpo com até 20.000 caracteres; no máximo 3 novidades fixadas ao mesmo tempo.

## Comportamento

### Público

| `audience` | Quem vê |
| --- | --- |
| `all` | Qualquer cadastrado |
| `active` | Quem tem ao menos um direito ativo a produto não `open` |
| `product` | Quem tem direito ativo a algum dos produtos listados ([010](010-direitos-de-acesso.md)) |

A equipe vê todas. Novidades não são visíveis a visitantes sem login.

### Estados

- `draft` → `scheduled` (com `publish_at` no futuro) → `published` → `archived`.
- A publicação agendada é feita pela tarefa `announcement.publish` do worker ([005](005-worker-e-fila.md)) no horário marcado, com atraso máximo de 1 minuto.
- Editar uma novidade publicada não a torna "não lida" de novo, salvo se quem edita marcar "avisar novamente".
- Arquivar remove da lista do aluno sem apagar.

### Não lidas

- O contador é o número de novidades publicadas, visíveis ao usuário, com `published_at` posterior a `announcements_seen_at` do usuário (ou à data de cadastro, a que for mais recente).
- Abrir a lista atualiza `announcements_seen_at` para agora. Não há controle de leitura por item.
- O contador é atualizado por SSE quando sai uma novidade nova para o público do usuário.

### Conteúdo

- Markdown saneado com as mesmas regras de [017](017-forum.md); capa conforme [029](029-imagens.md) (1200×630).
- Link de destino: rota interna (curso, evento, plano) ou URL `https` externa, exibido como botão.
- Sem comentários nem reações.

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /announcements`, `GET /announcements/{id}`, `GET /announcements/unread-count`, `POST /announcements/seen`.
- `apps/admin-api/openapi.yaml`: `GET|POST /announcements`, `GET|PATCH|DELETE /announcements/{id}`, `POST /announcements/{id}/publish`, `POST /announcements/{id}/archive`.
- Evento SSE `announcement.published` ([004](004-classroom-api.md)).

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `announcements` | `title`, `body_md`, `body_html`, `cover_image_id`, `audience`, `link_url`, `link_label`, `status`, `pinned`, `publish_at`, `published_at`, `notify`, `author_id` | `admin-api`; `worker` na publicação agendada |
| `announcement_products` | `announcement_id`, `product_type`, `product_id` | `admin-api` |
| `profiles.announcements_seen_at` | data da última abertura do mural | `classroom-api` |

Retenção: permanente até a equipe apagar.

## Critérios de aceite

- [ ] Novidade `product` aparece só para quem tem o produto e para a equipe.
- [ ] O contador sobe ao publicar e zera ao abrir a lista.
- [ ] Novidade agendada é publicada no horário, com no máximo 1 minuto de atraso.
- [ ] A quarta novidade fixada é recusada.
- [ ] Usuário recém-cadastrado não vê como "não lidas" as novidades anteriores ao cadastro.
- [ ] Instrutor só consegue publicar para os próprios cursos.

## Fora de escopo

- Comentários e reações, envio em massa por e-mail como campanha, segmentação além dos três públicos, histórico de versões.

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (F1-15)
