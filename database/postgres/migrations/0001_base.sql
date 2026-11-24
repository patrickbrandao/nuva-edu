-- 0001: base do banco.
-- UUID v7: o PostgreSQL 18 traz uuidv7() nativa, então não há função própria.

-- migrate:up

-- Busca textual simples com ILIKE e índice trigram (spec 003).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Mantém updated_at em toda tabela que tiver a coluna. Uso:
--   CREATE TRIGGER <tabela>_set_updated_at BEFORE UPDATE ON <tabela>
--     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Configuração da escola: uma linha por chave ('timezone', 'gamification.actions', ...).
CREATE TABLE settings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_key_unique UNIQUE (key),
  CONSTRAINT settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')
);

CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE settings;
DROP FUNCTION set_updated_at();
DROP EXTENSION IF EXISTS pg_trgm;
