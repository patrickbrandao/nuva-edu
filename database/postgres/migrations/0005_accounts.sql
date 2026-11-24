-- 0005: contas, sessões e suspensões (specs 007 e 026).
-- Donos dos dados: tabela "Dados" da spec 007 e de user_suspensions na spec 026.
--
-- Decisões de esquema que a spec não fixa (forma mais conservadora; relatadas ao arquiteto):
-- - A linha de users nunca é apagada (a exclusão anonimiza, spec 030). As tabelas que só
--   existem por causa da conta (profiles, oauth_identities, sessions, email_tokens,
--   user_devices) usam ON DELETE CASCADE; as que são registro de terceiros (suspensões,
--   suspended_by, images.owner_user_id) não deixam apagar o usuário (NO ACTION).
-- - email e name são NOT NULL. A anonimização da Fase 7 decide se os anula; afrouxar
--   NOT NULL depois é mudança não destrutiva.
-- - version começa em 1 e é incrementada pelo código (UPDATE ... SET version = version + 1
--   WHERE version = $n); não há gatilho.
-- - tax_id não tem formato no banco (o CNPJ alfanumérico convive com o numérico); só fica
--   amarrado a tax_id_type.
-- - Hashes de sessão e de token em text hexadecimal minúsculo, como image_variants.sha256.
-- - Índices de expurgo além dos pedidos (login_attempts.created_at, user_devices.last_seen_at,
--   email_tokens.expires_at), para as retenções da spec 033.

-- migrate:up

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Normalizado pela aplicação: minúsculas, sem espaços nas pontas.
  email text NOT NULL,
  email_verified_at timestamptz,
  -- Nome de exibição.
  name text NOT NULL,
  -- Nome completo, usado em pedidos e certificados (coletado no primeiro checkout, spec 011).
  full_name text,
  -- Texto legível por decisão (ADR 0002). Nula quando a conta não tem senha.
  password text,
  role text NOT NULL DEFAULT 'student',
  suspended_at timestamptz,
  suspended_kind text,
  suspended_reason text,
  suspended_by uuid,
  tax_id_type text,
  tax_id text,
  last_login_at timestamptz,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  -- Concorrência otimista (spec 003): divergência resulta em 409.
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT users_name_not_empty CHECK (btrim(name) <> ''),
  -- RNF-01 da spec 007.
  CONSTRAINT users_password_length CHECK (
    password IS NULL OR length(password) BETWEEN 8 AND 128
  ),
  CONSTRAINT users_role_valid CHECK (role IN ('student', 'instructor', 'manager', 'admin')),
  CONSTRAINT users_suspended_kind_valid CHECK (suspended_kind IN ('posting', 'full')),
  -- suspended_kind existe se, e só se, a conta está suspensa; motivo e autor só com suspensão.
  CONSTRAINT users_suspension_matches_suspended_at CHECK (
    (suspended_at IS NULL) = (suspended_kind IS NULL)
    AND (suspended_at IS NOT NULL OR (suspended_reason IS NULL AND suspended_by IS NULL))
  ),
  CONSTRAINT users_tax_id_type_valid CHECK (tax_id_type IN ('cpf', 'cnpj')),
  CONSTRAINT users_tax_id_matches_type CHECK ((tax_id_type IS NULL) = (tax_id IS NULL)),
  CONSTRAINT users_version_positive CHECK (version >= 1),
  CONSTRAINT users_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES users (id)
);

-- Um e-mail por conta ativa; o de conta excluída pode ser reaproveitado.
-- Login e cadastro: WHERE email = $1 AND deleted_at IS NULL.
CREATE UNIQUE INDEX users_email_active_unique ON users (email) WHERE deleted_at IS NULL;

-- Busca q da lista do admin (spec 003): WHERE name ILIKE '%' || $q || '%' OR email ILIKE ...
CREATE INDEX users_name_trgm_idx ON users USING gin (name gin_trgm_ops);
CREATE INDEX users_email_trgm_idx ON users USING gin (email gin_trgm_ops);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Perfil público. Nesta fase só o avatar; o resto entra com a spec 019 (Fase 6).
CREATE TABLE profiles (
  user_id uuid NOT NULL,
  avatar_image_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT profiles_avatar_image_id_fkey FOREIGN KEY (avatar_image_id)
    REFERENCES images (id) ON DELETE SET NULL
);

-- Expurgo das imagens órfãs (spec 029): NOT EXISTS (... WHERE avatar_image_id = images.id).
CREATE INDEX profiles_avatar_image_idx ON profiles (avatar_image_id);

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE oauth_identities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  -- Identificador do usuário no provedor (sub do OpenID; id do Graph no Facebook).
  provider_user_id text NOT NULL,
  -- E-mail informado pelo provedor, quando houver.
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_identities_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT oauth_identities_provider_valid CHECK (provider IN ('google', 'facebook', 'apple')),
  CONSTRAINT oauth_identities_provider_user_id_not_empty CHECK (provider_user_id <> '')
);

-- Uma identidade do provedor pertence a uma conta só (identity_in_use).
CREATE UNIQUE INDEX oauth_identities_provider_user_unique
  ON oauth_identities (provider, provider_user_id);

-- Métodos de acesso da conta: WHERE user_id = $1.
CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);

CREATE TABLE sessions (
  -- Identificador público, usado nas listas e para encerrar a sessão.
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- SHA-256 do identificador do cookie, em hexadecimal minúsculo. O valor em claro não é guardado.
  id_hash text NOT NULL,
  user_id uuid NOT NULL,
  site text NOT NULL,
  ip inet NOT NULL,
  user_agent text,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  -- last_used_at + 30 dias (NUVA_RETENTION_SESSION_DAYS), renovado no máximo uma vez por minuto.
  expires_at timestamptz NOT NULL,
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT sessions_site_valid CHECK (site IN ('classroom', 'admin')),
  CONSTRAINT sessions_id_hash_format CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_csrf_token_not_empty CHECK (csrf_token <> ''),
  CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at)
);

-- Validação a cada requisição: WHERE id_hash = $1.
CREATE UNIQUE INDEX sessions_id_hash_unique ON sessions (id_hash);

-- Sessões do usuário (lista e encerramento): WHERE user_id = $1 [AND site = $2].
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Expurgo das vencidas: WHERE expires_at < now().
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- SHA-256 do token, em hexadecimal minúsculo. O token em claro existe só no e-mail.
  token_hash text NOT NULL,
  user_id uuid NOT NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT email_tokens_purpose_valid CHECK (purpose IN ('verify', 'reset')),
  CONSTRAINT email_tokens_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_tokens_expires_after_created CHECK (expires_at > created_at)
);

-- Uso do link: WHERE token_hash = $1.
CREATE UNIQUE INDEX email_tokens_token_hash_unique ON email_tokens (token_hash);

-- Token novo invalida os anteriores: WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL.
CREATE INDEX email_tokens_user_purpose_idx ON email_tokens (user_id, purpose)
  WHERE used_at IS NULL;

-- Expurgo (24 h): WHERE expires_at < now().
CREATE INDEX email_tokens_expires_at_idx ON email_tokens (expires_at);

CREATE TABLE login_attempts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- E-mail normalizado tal como digitado, inclusive o de conta inexistente.
  email text NOT NULL,
  ip inet NOT NULL,
  success boolean NOT NULL,
  site text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_attempts_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT login_attempts_site_valid CHECK (site IN ('classroom', 'admin'))
);

-- Bloqueio por conta (RNF-02): WHERE email = $1 AND created_at > now() - interval '15 minutes'.
CREATE INDEX login_attempts_email_created_idx ON login_attempts (email, created_at);

-- Bloqueio por IP (RNF-02): WHERE ip = $1 AND created_at > now() - interval '15 minutes'.
CREATE INDEX login_attempts_ip_created_idx ON login_attempts (ip, created_at);

-- Expurgo (30 dias): WHERE created_at < now() - interval '30 days'.
CREATE INDEX login_attempts_created_at_idx ON login_attempts (created_at);

CREATE TABLE user_devices (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  -- Família do navegador e sistema, lidos do User-Agent (ex.: 'Chrome|macOS').
  device_key text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_devices_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT user_devices_device_key_not_empty CHECK (device_key <> '')
);

-- Dispositivo conhecido: WHERE user_id = $1 AND device_key = $2 (ON CONFLICT na inserção).
CREATE UNIQUE INDEX user_devices_user_device_unique ON user_devices (user_id, device_key);

-- Expurgo (1 ano sem uso): WHERE last_seen_at < now() - interval '1 year'.
CREATE INDEX user_devices_last_seen_at_idx ON user_devices (last_seen_at);

-- Histórico de suspensões (spec 026). O estado vigente fica em users.suspended_*.
CREATE TABLE user_suspensions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  -- Nulo: prazo indeterminado.
  ends_at timestamptz,
  -- Encerrada antes do prazo pela equipe ou, no fim do prazo, pelo worker.
  lifted_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_suspensions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT user_suspensions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT user_suspensions_kind_valid CHECK (kind IN ('posting', 'full')),
  CONSTRAINT user_suspensions_reason_not_empty CHECK (btrim(reason) <> ''),
  CONSTRAINT user_suspensions_ends_after_starts CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT user_suspensions_lifted_after_starts CHECK (
    lifted_at IS NULL OR lifted_at >= starts_at
  )
);

-- suspension.expire: WHERE lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at <= now().
CREATE INDEX user_suspensions_expire_idx ON user_suspensions (ends_at)
  WHERE lifted_at IS NULL AND ends_at IS NOT NULL;

-- Histórico na ficha do usuário: WHERE user_id = $1 ORDER BY starts_at DESC.
CREATE INDEX user_suspensions_user_starts_idx ON user_suspensions (user_id, starts_at);

-- Chave estrangeira que a 0004 deixou para cá (índice images_owner_created_idx a atende).
ALTER TABLE images
  ADD CONSTRAINT images_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id);

-- migrate:down

ALTER TABLE images DROP CONSTRAINT images_owner_user_id_fkey;
DROP TABLE user_suspensions;
DROP TABLE user_devices;
DROP TABLE login_attempts;
DROP TABLE email_tokens;
DROP TABLE sessions;
DROP TABLE oauth_identities;
DROP TABLE profiles;
DROP TABLE users;
