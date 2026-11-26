-- 0019: calendário e eventos (spec 018, "Dados" e "Comportamento") e novidades (spec 025,
-- "Dados" e "Comportamento").
-- Donos dos dados: events e event_products, a admin-api; announcements e
-- announcement_products, a admin-api (o worker publica a agendada e atualiza published_at);
-- profiles.announcements_seen_at, a classroom-api.
-- Reutiliza users (0005), courses e lessons (0009), images (0004 e 029, capa dos eventos e das
-- novidades), notifications e notification_prefs (0016, event.created/reminder/canceled e
-- announcement.published), jobs (0002, lembrete e publicação agendada), settings (0001, fuso da
-- escola) e audit_log (0006): esta migration não cria infraestrutura de conta, catálogo, imagem,
-- notificação, fila nem auditoria.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 a 0018; relatadas ao
-- arquiteto na tarefa 577):
-- - events.status não existe: upcoming, live e past saem do relógio e o banco guarda só o
--   cancelamento (canceled_at), como a spec manda. O status é calculado a partir de starts_at e
--   ends_at, e canceled_at não apaga o horário (a agenda mostra o riscado até a data).
-- - Título de evento sem faixa na spec: não vazio e até 160 caracteres, teto de cursos e do
--   fórum. A descrição é obrigatória e segue a ADR 0027 (description_md e description_html
--   gravados juntos, até 20.000 caracteres, como as demais publicações).
-- - events.cover_image_id não aparece na tabela de dados da 018, mas a 029 dá a finalidade
--   event_cover e cita events na referência do expurgo de imagens; sem a coluna a finalidade
--   ficaria sem dono. announcements.cover_image_id usa content_image (029): "usada em descrições
--   e novidades". As duas chaves são ON DELETE SET NULL e têm índice parcial para o expurgo.
-- - stream_url aceita nulo enquanto o link não existe; com valor, exige https e até 2.000
--   caracteres, como as URLs do catálogo. O sigilo do link (fora de listagens e fora do público)
--   é regra do código: o banco não conhece o público de cada leitura.
-- - series_id não tem tabela nem chave estrangeira: é só o agrupamento da recorrência semanal
--   (RF-06 da 018), com o mesmo uuid nas N linhas independentes; a edição é sempre por evento.
-- - audience guarda só o rótulo (all, active, product). A pertinência ao público (direito ativo
--   a produto não open, equipe, lista de event_products/announcement_products) é resolvida pelo
--   código a partir de entitlements (0010). Product_id é polimórfico e sem chave estrangeira,
--   como em bundle_items e coupon_products; o banco não obriga audience = 'product' a ter linha,
--   porque a lista e o evento são gravados na mesma transação e a validação é do código.
-- - events.recording_lesson_id é ON DELETE SET NULL: apagar a aula mantém o evento, que deixa de
--   ter gravação. A aula não precisa ser do course_id do evento; o acesso segue a regra da
--   própria aula (018 e 014), por isso o banco não amarra os dois vínculos.
-- - canceled_at só marca o cancelamento; quem cancelou e o motivo ficam em audit_log (028).
-- - announces: a spec lista publish_at e published_at, mas não a data do arquivamento; archived_at
--   entra para o estado archived ter instante. Estado e datas andam juntos, no mesmo estilo de
--   tickets (0018): draft e scheduled não têm published_at; published exige published_at; archived
--   exige published_at e archived_at (posterior). scheduled exige publish_at.
-- - Fixadas: no máximo 3 ao mesmo tempo (RNF-02), o que não cabe em CHECK nem em índice único
--   porque o limite é entre linhas. Gatilho com trava consultiva conta as fixadas e recusa a
--   quarta; a fixada nunca é arquivada (CHECK), então arquivar obriga o código a limpar pinned e
--   o limite não vira vitalício. O índice parcial em pinned atende a contagem.
-- - notify nasce falso: avisar é escolha explícita de quem publica (RF-05 da 025) e não se
--   confunde com a preferência do destinatário (notification_prefs, 0016). A novidade publicada
--   conta como não lida pelo published_at, independentemente de notify.
-- - Título da novidade: 5 a 150 (RNF-02). O piso de 5 é do código, como no fórum (0017); o banco
--   recusa vazio e acima de 150. Corpo em Markdown saneado (ADR 0027) de até 20.000 caracteres.
-- - link_url é rota interna (começa com "/" e não "//") ou URL https externa, até 2.000
--   caracteres; link_label só existe junto da URL, não vazio e até 100 caracteres.
-- - profiles.announcements_seen_at nulo = nunca abriu o mural; a regra "a partir do cadastro, a
--   que for mais recente" é do código (025), que também atualiza a coluna ao abrir a lista. Sem
--   índice: a leitura é pela chave primária de profiles.
-- - author_id e created_by são sem cascata: a linha de users nunca é apagada (spec 030). A
--   exclusão de conta anonimiza o autor, que continua sendo exibido como "usuário removido".
-- - Retenção (018 e 025): permanente, até a equipe apagar; sem índice de expurgo. As capas
--   entram no expurgo das imagens órfãs de 24 horas (029) pelos índices parciais abaixo.

-- migrate:up

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  title text NOT NULL,
  -- Markdown saneado e HTML correspondente, gravados juntos (ADR 0027).
  description_md text NOT NULL,
  description_html text NOT NULL,
  -- live, meeting, workshop ou other (018).
  kind text NOT NULL,
  -- Horários em UTC; exibição no fuso do navegador (018).
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Nulo enquanto o link não existe; com valor, https (RF-04). Nunca sai em listagem.
  stream_url text,
  -- all, active ou product (018); a pertinência é resolvida pelo código.
  audience text NOT NULL DEFAULT 'all',
  -- Curso relacionado opcional; sobrevive à exclusão do curso.
  course_id uuid,
  -- Aula que recebe a gravação; sobrevive à exclusão da aula, sem gravação.
  recording_lesson_id uuid,
  -- Agrupamento da recorrência semanal (uuid compartilhado pelas N linhas independentes).
  series_id uuid,
  cover_image_id uuid,
  -- Cancelamento manual (RF-03); o restante do status sai do relógio.
  canceled_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_title_length CHECK (
    btrim(title) <> '' AND char_length(title) <= 160
  ),
  CONSTRAINT events_description_md_length CHECK (
    btrim(description_md) <> '' AND char_length(description_md) <= 20000
  ),
  CONSTRAINT events_description_html_not_empty CHECK (description_html <> ''),
  CONSTRAINT events_kind_valid CHECK (kind IN ('live', 'meeting', 'workshop', 'other')),
  CONSTRAINT events_audience_valid CHECK (audience IN ('all', 'active', 'product')),
  CONSTRAINT events_stream_url_format CHECK (
    stream_url IS NULL OR (
      char_length(stream_url) <= 2000 AND stream_url ~ '^https://'
    )
  ),
  -- RF-03 e RNF-02 da 018: fim depois do início, duração máxima de 12 horas.
  CONSTRAINT events_ends_after_starts CHECK (ends_at > starts_at),
  CONSTRAINT events_duration_limit CHECK (ends_at <= starts_at + interval '12 hours'),
  CONSTRAINT events_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE SET NULL,
  CONSTRAINT events_recording_lesson_id_fkey FOREIGN KEY (recording_lesson_id)
    REFERENCES lessons (id) ON DELETE SET NULL,
  CONSTRAINT events_cover_image_id_fkey FOREIGN KEY (cover_image_id)
    REFERENCES images (id) ON DELETE SET NULL,
  CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id)
);

-- Agenda do mês e lista por período: WHERE starts_at >= $1 AND starts_at < $2
-- ORDER BY starts_at, id. Atende também o banner do evento ao vivo (starts_at <= now()).
CREATE INDEX events_starts_idx ON events (starts_at, id);

-- Aba "Gravações" (RF-06): WHERE recording_lesson_id IS NOT NULL AND canceled_at IS NULL
-- ORDER BY starts_at DESC, id DESC.
CREATE INDEX events_recording_idx ON events (starts_at DESC, id DESC)
  WHERE recording_lesson_id IS NOT NULL AND canceled_at IS NULL;

-- Eventos de um curso e escopo do instrutor: WHERE course_id = $1 ORDER BY starts_at DESC.
CREATE INDEX events_course_idx ON events (course_id, starts_at DESC)
  WHERE course_id IS NOT NULL;

-- Recorrência: WHERE series_id = $1, para editar ou conferir as N semanas.
CREATE INDEX events_series_idx ON events (series_id) WHERE series_id IS NOT NULL;

-- Expurgo de imagens órfãs (spec 029): WHERE cover_image_id = $1.
CREATE INDEX events_cover_image_idx ON events (cover_image_id)
  WHERE cover_image_id IS NOT NULL;

CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Produtos do público 'product' (018). Vazio = ninguém fora da equipe.
CREATE TABLE event_products (
  event_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_products_pkey PRIMARY KEY (event_id, product_type, product_id),
  CONSTRAINT event_products_event_id_fkey FOREIGN KEY (event_id)
    REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT event_products_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  )
);

-- Eventos de um produto e resolução do público: WHERE product_type = $1 AND product_id = $2.
CREATE INDEX event_products_product_idx ON event_products (product_type, product_id);

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  title text NOT NULL,
  -- Markdown saneado e HTML correspondente, gravados juntos (ADR 0027).
  body_md text NOT NULL,
  body_html text NOT NULL,
  cover_image_id uuid,
  -- all, active ou product (025); a pertinência é resolvida pelo código.
  audience text NOT NULL DEFAULT 'all',
  -- Rota interna ou URL https externa, exibida como botão.
  link_url text,
  link_label text,
  -- draft, scheduled, published ou archived (025).
  status text NOT NULL DEFAULT 'draft',
  -- Fixada no topo da lista; no máximo 3 (RNF-02), garantido pelo gatilho abaixo.
  pinned boolean NOT NULL DEFAULT false,
  -- Início da publicação agendada (status scheduled).
  publish_at timestamptz,
  -- Instante da publicação; obrigatório em published e archived.
  published_at timestamptz,
  archived_at timestamptz,
  -- Avisar por notificação ao publicar (RF-05); escolha explícita de quem publica.
  notify boolean NOT NULL DEFAULT false,
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_title_length CHECK (
    btrim(title) <> '' AND char_length(title) <= 150
  ),
  CONSTRAINT announcements_body_md_length CHECK (
    btrim(body_md) <> '' AND char_length(body_md) <= 20000
  ),
  CONSTRAINT announcements_body_html_not_empty CHECK (body_html <> ''),
  CONSTRAINT announcements_audience_valid CHECK (audience IN ('all', 'active', 'product')),
  CONSTRAINT announcements_status_valid CHECK (
    status IN ('draft', 'scheduled', 'published', 'archived')
  ),
  -- Estado e datas coerentes: ver o cabeçalho.
  CONSTRAINT announcements_status_matches_timestamps CHECK (
    (status = 'draft' AND published_at IS NULL AND archived_at IS NULL)
    OR (status = 'scheduled' AND publish_at IS NOT NULL
      AND published_at IS NULL AND archived_at IS NULL)
    OR (status = 'published' AND published_at IS NOT NULL AND archived_at IS NULL)
    OR (status = 'archived' AND published_at IS NOT NULL AND archived_at IS NOT NULL
      AND archived_at >= published_at)
  ),
  CONSTRAINT announcements_link_url_format CHECK (
    link_url IS NULL OR (
      char_length(link_url) <= 2000
      AND (link_url ~ '^https://' OR link_url ~ '^/[^/]')
    )
  ),
  CONSTRAINT announcements_link_label_length CHECK (
    char_length(link_label) <= 100
  ),
  CONSTRAINT announcements_link_label_matches_url CHECK (
    link_label IS NULL OR (btrim(link_label) <> '' AND link_url IS NOT NULL)
  ),
  -- Fixada arquivada não teria sentido: arquivar limpa pinned (o código o faz na transação).
  CONSTRAINT announcements_pinned_not_archived CHECK (NOT pinned OR status <> 'archived'),
  CONSTRAINT announcements_cover_image_id_fkey FOREIGN KEY (cover_image_id)
    REFERENCES images (id) ON DELETE SET NULL,
  CONSTRAINT announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES users (id)
);

-- Lista do aluno (025, RF-03): WHERE status = 'published'
-- ORDER BY pinned DESC, published_at DESC, id DESC.
CREATE INDEX announcements_published_list_idx
  ON announcements (pinned DESC, published_at DESC, id DESC)
  WHERE status = 'published';

-- Contador de não lidas e marcação por data: WHERE status = 'published'
-- AND published_at > profiles.announcements_seen_at.
CREATE INDEX announcements_published_at_idx ON announcements (published_at)
  WHERE status = 'published';

-- Lista do admin com filtro de estado: WHERE status = $1 ORDER BY created_at DESC, id DESC.
CREATE INDEX announcements_status_created_idx
  ON announcements (status, created_at DESC, id DESC);

-- Publicação agendada (announcement.publish): WHERE status = 'scheduled' AND publish_at <= now().
CREATE INDEX announcements_scheduled_idx ON announcements (publish_at, id)
  WHERE status = 'scheduled';

-- Contagem das fixadas pelo gatilho: WHERE pinned.
CREATE INDEX announcements_pinned_idx ON announcements (id) WHERE pinned;

-- Expurgo de imagens órfãs (spec 029): WHERE cover_image_id = $1.
CREATE INDEX announcements_cover_image_idx ON announcements (cover_image_id)
  WHERE cover_image_id IS NOT NULL;

CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RNF-02 da 025: no máximo 3 novidades fixadas. A contagem é entre linhas e precisa valer
-- também entre transações concorrentes, então a trava consultiva serializa a checagem.
CREATE FUNCTION announcements_guard_pinned() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT NEW.pinned THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.pinned THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('announcements.pinned'));
  IF (SELECT count(*) FROM announcements WHERE pinned AND id <> NEW.id) >= 3 THEN
    RAISE EXCEPTION 'announcements: no máximo 3 novidades fixadas'
      USING ERRCODE = '23514', CONSTRAINT = 'announcements_pinned_limit';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER announcements_guard_pinned
  BEFORE INSERT OR UPDATE OF pinned ON announcements
  FOR EACH ROW EXECUTE FUNCTION announcements_guard_pinned();

-- Produtos do público 'product' (025). Vazio = ninguém fora da equipe.
CREATE TABLE announcement_products (
  announcement_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_products_pkey PRIMARY KEY (announcement_id, product_type, product_id),
  CONSTRAINT announcement_products_announcement_id_fkey FOREIGN KEY (announcement_id)
    REFERENCES announcements (id) ON DELETE CASCADE,
  CONSTRAINT announcement_products_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  )
);

-- Novidades de um produto e resolução do público: WHERE product_type = $1 AND product_id = $2.
CREATE INDEX announcement_products_product_idx
  ON announcement_products (product_type, product_id);

-- Data da última abertura do mural (025). Nulo = nunca abriu.
ALTER TABLE profiles ADD COLUMN announcements_seen_at timestamptz;

-- migrate:down

ALTER TABLE profiles DROP COLUMN announcements_seen_at;
DROP TABLE announcement_products;
DROP TRIGGER announcements_guard_pinned ON announcements;
DROP FUNCTION announcements_guard_pinned();
DROP TABLE announcements;
DROP TABLE event_products;
DROP TABLE events;
