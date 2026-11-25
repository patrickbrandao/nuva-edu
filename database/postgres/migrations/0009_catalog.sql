-- 0009: catálogo e conteúdo (spec 009, "Dados").
-- Dono dos dados: admin-api escreve; classroom-api e worker leem.
--
-- Decisões de esquema que a spec não fixa (relatadas ao arquiteto na tarefa 403):
-- - courses, modules, lessons, ebooks e bundles têm version (concorrência otimista da
--   spec 003: edição envia version, divergência resulta em 409), começando em 1.
-- - ebooks, bundles e lesson_links também têm created_at e updated_at; bundle_items e
--   product_ebooks, só created_at.
-- - Slug: minúsculas, números e hífens, até 160 caracteres, único na própria tabela (um
--   curso e um ebook podem ter o mesmo slug: a URL da vitrine leva o tipo).
-- - Produto publicado tem published_at; ebook publicado tem file_url. Arquivar não é
--   amarrado ao estado no banco (é regra do código: archive despublica).
-- - Excluir curso apaga módulos, aulas e links em cascata (spec 009); a recusa de exclusão
--   com vínculos (409 product_has_links) é regra do código (resposta à P2, tarefa 463).
-- - bundle_items.product_id e product_ebooks.target_id são polimórficos e sem chave
--   estrangeira: a existência do alvo é conferida pelo código. Pacote dentro de pacote é
--   impedido pelo CHECK de product_type.
-- - URL no banco: http(s), sem espaço, até 2.000 caracteres. As demais regras (https
--   obrigatório fora de *.localhost, sem credenciais, classificação do provedor) são do código.
-- - Limites de quantidade da RNF-03 (100 módulos, 500 aulas, 20 links) são do código.

-- migrate:up

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL,
  title text NOT NULL,
  summary text,
  -- Markdown restrito (spec 009).
  description text,
  level text,
  cover_image_id uuid,
  -- Instrutor dono; nulo quando o curso é gerido só por gerente e admin.
  owner_id uuid,
  access_mode text NOT NULL DEFAULT 'open',
  price_cents bigint,
  -- Validade do direito em dias; nulo = vitalício.
  access_days integer,
  certificate_enabled boolean NOT NULL DEFAULT true,
  -- Carga horária fixada pelo admin; nulo = calculada na emissão (spec 015).
  certificate_hours integer,
  status text NOT NULL DEFAULT 'draft',
  -- "Enviar para publicação" do instrutor; limpo ao publicar (spec 009).
  review_requested_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_slug_unique UNIQUE (slug),
  CONSTRAINT courses_slug_format CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 160
  ),
  CONSTRAINT courses_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT courses_summary_length CHECK (char_length(summary) <= 300),
  CONSTRAINT courses_description_length CHECK (char_length(description) <= 20000),
  CONSTRAINT courses_level_valid CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  CONSTRAINT courses_access_mode_valid CHECK (access_mode IN ('open', 'paid', 'private')),
  CONSTRAINT courses_price_cents_range CHECK (price_cents >= 0),
  CONSTRAINT courses_price_matches_access_mode CHECK (
    access_mode <> 'open' OR price_cents IS NULL
  ),
  CONSTRAINT courses_access_days_range CHECK (access_days >= 1),
  CONSTRAINT courses_certificate_hours_range CHECK (certificate_hours >= 1),
  CONSTRAINT courses_status_valid CHECK (status IN ('draft', 'published')),
  CONSTRAINT courses_published_at_matches_status CHECK (
    status <> 'published' OR published_at IS NOT NULL
  ),
  CONSTRAINT courses_version_positive CHECK (version >= 1),
  CONSTRAINT courses_cover_image_id_fkey FOREIGN KEY (cover_image_id)
    REFERENCES images (id) ON DELETE SET NULL,
  CONSTRAINT courses_owner_id_fkey FOREIGN KEY (owner_id)
    REFERENCES users (id) ON DELETE SET NULL
);

-- Vitrine e listas do admin: WHERE status = 'published' AND access_mode IN (...)
-- AND archived_at IS NULL.
CREATE INDEX courses_catalog_idx ON courses (status, access_mode, archived_at);
-- Cursos do instrutor (permissão de dono) e chave estrangeira de owner_id.
CREATE INDEX courses_owner_idx ON courses (owner_id);
-- Filtro "aguardando publicação": WHERE review_requested_at IS NOT NULL.
CREATE INDEX courses_review_requested_idx ON courses (review_requested_at)
  WHERE review_requested_at IS NOT NULL;
-- Expurgo de imagens órfãs (spec 029): WHERE cover_image_id = $1.
CREATE INDEX courses_cover_image_idx ON courses (cover_image_id)
  WHERE cover_image_id IS NOT NULL;
-- Busca: title ILIKE '%termo%' OR summary ILIKE '%termo%'.
CREATE INDEX courses_title_trgm_idx ON courses USING gin (title gin_trgm_ops);
CREATE INDEX courses_summary_trgm_idx ON courses USING gin (summary gin_trgm_ops);

CREATE TRIGGER courses_set_updated_at BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE modules (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  course_id uuid NOT NULL,
  title text NOT NULL,
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modules_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT modules_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT modules_position_range CHECK (position >= 0),
  CONSTRAINT modules_version_positive CHECK (version >= 1),
  -- Reordenação numa transação (PUT .../modules/order): a unicidade é conferida no COMMIT.
  -- Programa: WHERE course_id = $1 ORDER BY position.
  CONSTRAINT modules_course_position_unique UNIQUE (course_id, position)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER modules_set_updated_at BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lessons (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  module_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  -- Extensão futura (questionário); o MVP só usa video.
  type text NOT NULL DEFAULT 'video',
  video_url text,
  -- Classificado pelo código na gravação de video_url (spec 009, "Vídeo e links externos").
  video_provider text,
  -- Informado pelo autor.
  duration_seconds integer NOT NULL DEFAULT 0,
  is_sample boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  position integer NOT NULL,
  -- Tópico da aula no fórum; a chave estrangeira entra com o fórum (spec 017, Fase 4).
  forum_topic_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessons_module_id_fkey FOREIGN KEY (module_id)
    REFERENCES modules (id) ON DELETE CASCADE,
  CONSTRAINT lessons_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT lessons_description_length CHECK (char_length(description) <= 20000),
  CONSTRAINT lessons_type_valid CHECK (type IN ('video')),
  CONSTRAINT lessons_video_url_format CHECK (
    video_url ~ '^https?://\S+$' AND char_length(video_url) <= 2000
  ),
  CONSTRAINT lessons_video_provider_valid CHECK (
    video_provider IN ('youtube', 'vimeo', 'bunny', 'panda', 'file', 'link')
  ),
  CONSTRAINT lessons_video_provider_matches_url CHECK (
    (video_url IS NULL) = (video_provider IS NULL)
  ),
  CONSTRAINT lessons_duration_seconds_range CHECK (duration_seconds >= 0),
  CONSTRAINT lessons_status_valid CHECK (status IN ('draft', 'published')),
  CONSTRAINT lessons_position_range CHECK (position >= 0),
  CONSTRAINT lessons_version_positive CHECK (version >= 1),
  -- Reordenação numa transação; programa: WHERE module_id = ANY($1) ORDER BY module_id, position.
  CONSTRAINT lessons_module_position_unique UNIQUE (module_id, position)
    DEFERRABLE INITIALLY DEFERRED
);

-- "Aulas liberadas" (início e estante): WHERE is_sample AND status = 'published'.
CREATE INDEX lessons_sample_idx ON lessons (module_id) WHERE is_sample;

CREATE TRIGGER lessons_set_updated_at BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lesson_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  lesson_id uuid NOT NULL,
  label text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_links_lesson_id_fkey FOREIGN KEY (lesson_id)
    REFERENCES lessons (id) ON DELETE CASCADE,
  CONSTRAINT lesson_links_label_length CHECK (btrim(label) <> '' AND char_length(label) <= 160),
  CONSTRAINT lesson_links_url_format CHECK (
    url ~ '^https?://\S+$' AND char_length(url) <= 2000
  ),
  CONSTRAINT lesson_links_kind_valid CHECK (kind IN ('file', 'page')),
  CONSTRAINT lesson_links_position_range CHECK (position >= 0),
  -- PUT /lessons/{id}/links troca a lista inteira numa transação.
  CONSTRAINT lesson_links_lesson_position_unique UNIQUE (lesson_id, position)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER lesson_links_set_updated_at BEFORE UPDATE ON lesson_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ebooks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL,
  title text NOT NULL,
  summary text,
  description text,
  cover_image_id uuid,
  author_name text,
  file_url text,
  pages integer,
  access_mode text NOT NULL DEFAULT 'open',
  price_cents bigint,
  access_days integer,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ebooks_slug_unique UNIQUE (slug),
  CONSTRAINT ebooks_slug_format CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 160
  ),
  CONSTRAINT ebooks_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT ebooks_summary_length CHECK (char_length(summary) <= 300),
  CONSTRAINT ebooks_description_length CHECK (char_length(description) <= 20000),
  CONSTRAINT ebooks_author_name_length CHECK (
    btrim(author_name) <> '' AND char_length(author_name) <= 160
  ),
  CONSTRAINT ebooks_file_url_format CHECK (
    file_url ~ '^https?://\S+$' AND char_length(file_url) <= 2000
  ),
  CONSTRAINT ebooks_pages_range CHECK (pages >= 1),
  CONSTRAINT ebooks_access_mode_valid CHECK (access_mode IN ('open', 'paid', 'private')),
  CONSTRAINT ebooks_price_cents_range CHECK (price_cents >= 0),
  CONSTRAINT ebooks_price_matches_access_mode CHECK (
    access_mode <> 'open' OR price_cents IS NULL
  ),
  CONSTRAINT ebooks_access_days_range CHECK (access_days >= 1),
  CONSTRAINT ebooks_status_valid CHECK (status IN ('draft', 'published')),
  CONSTRAINT ebooks_published_at_matches_status CHECK (
    status <> 'published' OR published_at IS NOT NULL
  ),
  -- Publicar ebook exige file_url (spec 009).
  CONSTRAINT ebooks_file_url_matches_status CHECK (
    status <> 'published' OR file_url IS NOT NULL
  ),
  CONSTRAINT ebooks_version_positive CHECK (version >= 1),
  CONSTRAINT ebooks_cover_image_id_fkey FOREIGN KEY (cover_image_id)
    REFERENCES images (id) ON DELETE SET NULL
);

CREATE INDEX ebooks_catalog_idx ON ebooks (status, access_mode, archived_at);
CREATE INDEX ebooks_cover_image_idx ON ebooks (cover_image_id)
  WHERE cover_image_id IS NOT NULL;
CREATE INDEX ebooks_title_trgm_idx ON ebooks USING gin (title gin_trgm_ops);
CREATE INDEX ebooks_summary_trgm_idx ON ebooks USING gin (summary gin_trgm_ops);

CREATE TRIGGER ebooks_set_updated_at BEFORE UPDATE ON ebooks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bundles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL,
  title text NOT NULL,
  summary text,
  description text,
  cover_image_id uuid,
  access_mode text NOT NULL DEFAULT 'open',
  price_cents bigint,
  access_days integer,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundles_slug_unique UNIQUE (slug),
  CONSTRAINT bundles_slug_format CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 160
  ),
  CONSTRAINT bundles_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT bundles_summary_length CHECK (char_length(summary) <= 300),
  CONSTRAINT bundles_description_length CHECK (char_length(description) <= 20000),
  CONSTRAINT bundles_access_mode_valid CHECK (access_mode IN ('open', 'paid', 'private')),
  CONSTRAINT bundles_price_cents_range CHECK (price_cents >= 0),
  CONSTRAINT bundles_price_matches_access_mode CHECK (
    access_mode <> 'open' OR price_cents IS NULL
  ),
  CONSTRAINT bundles_access_days_range CHECK (access_days >= 1),
  CONSTRAINT bundles_status_valid CHECK (status IN ('draft', 'published')),
  CONSTRAINT bundles_published_at_matches_status CHECK (
    status <> 'published' OR published_at IS NOT NULL
  ),
  CONSTRAINT bundles_version_positive CHECK (version >= 1),
  CONSTRAINT bundles_cover_image_id_fkey FOREIGN KEY (cover_image_id)
    REFERENCES images (id) ON DELETE SET NULL
);

CREATE INDEX bundles_catalog_idx ON bundles (status, access_mode, archived_at);
CREATE INDEX bundles_cover_image_idx ON bundles (cover_image_id)
  WHERE cover_image_id IS NOT NULL;
CREATE INDEX bundles_title_trgm_idx ON bundles USING gin (title gin_trgm_ops);
CREATE INDEX bundles_summary_trgm_idx ON bundles USING gin (summary gin_trgm_ops);

CREATE TRIGGER bundles_set_updated_at BEFORE UPDATE ON bundles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bundle_items (
  bundle_id uuid NOT NULL,
  -- Nunca 'bundle': pacote não contém pacote (spec 009).
  product_type text NOT NULL,
  -- courses.id ou ebooks.id, conforme product_type; sem chave estrangeira (polimórfico).
  product_id uuid NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_items_pkey PRIMARY KEY (bundle_id, product_type, product_id),
  CONSTRAINT bundle_items_bundle_id_fkey FOREIGN KEY (bundle_id)
    REFERENCES bundles (id) ON DELETE CASCADE,
  CONSTRAINT bundle_items_product_type_valid CHECK (product_type IN ('course', 'ebook')),
  CONSTRAINT bundle_items_position_range CHECK (position >= 0),
  -- PUT /bundles/{id}/items troca a lista inteira numa transação.
  CONSTRAINT bundle_items_bundle_position_unique UNIQUE (bundle_id, position)
    DEFERRABLE INITIALLY DEFERRED
);

-- Cascata (spec 010) e vínculos do produto: pacotes que contêm o curso ou o ebook,
-- WHERE product_type = $1 AND product_id = $2.
CREATE INDEX bundle_items_product_idx ON bundle_items (product_type, product_id);

CREATE TABLE product_ebooks (
  ebook_id uuid NOT NULL,
  target_type text NOT NULL,
  -- courses.id, bundles.id ou lessons.id, conforme target_type; sem chave estrangeira.
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_ebooks_pkey PRIMARY KEY (ebook_id, target_type, target_id),
  CONSTRAINT product_ebooks_ebook_id_fkey FOREIGN KEY (ebook_id)
    REFERENCES ebooks (id) ON DELETE CASCADE,
  CONSTRAINT product_ebooks_target_type_valid CHECK (
    target_type IN ('course', 'bundle', 'lesson')
  )
);

-- Cascata e aba de materiais: ebooks do alvo, WHERE target_type = $1 AND target_id = ANY($2).
CREATE INDEX product_ebooks_target_idx ON product_ebooks (target_type, target_id);

-- migrate:down

DROP TABLE product_ebooks;
DROP TABLE bundle_items;
DROP TABLE bundles;
DROP TABLE ebooks;
DROP TABLE lesson_links;
DROP TABLE lessons;
DROP TABLE modules;
DROP TABLE courses;
