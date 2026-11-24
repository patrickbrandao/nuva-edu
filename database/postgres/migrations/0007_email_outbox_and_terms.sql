-- 0007: fila de e-mails (spec 024) e termos com aceites (spec 030, "Termos na Fase 1").
-- Donos dos dados: email_outbox, o worker (envio), com inserção pela enqueueEmail de
-- packages/core; terms_versions, a admin-api; terms_acceptances, a classroom-api.
--
-- Decisões de esquema que a spec não fixa (forma mais conservadora; relatadas ao arquiteto):
-- - email_outbox."to" segue o nome da spec; é palavra reservada e vai sempre entre aspas no SQL.
-- - sent_at existe se, e só se, status = 'sent' (o "reenviar" devolve failed a queued).
--   subject não é amarrado ao estado: o envio pulado (skipped: already_verified) fica sent
--   sem montar o e-mail.
-- - Expurgo dos com falha (90 dias) conta de created_at: a tabela não tem data da falha.
-- - Versão publicada não aceita UPDATE nem DELETE (a spec pede só o UPDATE; apagar a publicada
--   também a alteraria para quem a aceitou). Rascunho pode ser publicado ou apagado.
-- - terms_acceptances não confere no banco que a versão é publicada: é a regra "vigente" da
--   classroom-api (terms_version_outdated).
-- - FKs para users sem cascata: a linha de users nunca é apagada (spec 030) e os aceites são
--   mantidos na exclusão de conta, sem IP nem navegador.

-- migrate:up

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  -- E-mail atual do usuário no momento do enfileiramento.
  "to" text NOT NULL,
  -- Tipo do catálogo da spec 024 ('account.verify_email', 'moderation.suspended', ...).
  type text NOT NULL,
  -- Nulo até o envio: o worker o preenche ao montar o e-mail.
  subject text,
  -- Dados do modelo. Nunca senha, token nem motivo interno de suspensão.
  data jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT email_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT email_outbox_status_valid CHECK (status IN ('queued', 'sent', 'failed')),
  CONSTRAINT email_outbox_type_format CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT email_outbox_to_not_empty CHECK (btrim("to") <> ''),
  CONSTRAINT email_outbox_data_object CHECK (jsonb_typeof(data) = 'object'),
  CONSTRAINT email_outbox_attempts_range CHECK (attempts >= 0),
  CONSTRAINT email_outbox_sent_at_matches_status CHECK (
    (status = 'sent') = (sent_at IS NOT NULL)
  )
);

-- Tela de operação (pendentes e com falha, mais antigos primeiro) e expurgo dos com falha:
-- WHERE status IN ('queued', 'failed') ORDER BY created_at;
-- WHERE status = 'failed' AND created_at < now() - interval '90 days'.
CREATE INDEX email_outbox_status_created_idx ON email_outbox (status, created_at);

-- Expurgo dos enviados (30 dias): WHERE status = 'sent' AND sent_at < now() - interval '30 days'.
CREATE INDEX email_outbox_sent_at_idx ON email_outbox (sent_at) WHERE status = 'sent';

-- Falhas permanentes seguidas do usuário (undeliverable): WHERE user_id = $1
-- ORDER BY created_at DESC LIMIT 3. Atende também à chave estrangeira.
CREATE INDEX email_outbox_user_created_idx ON email_outbox (user_id, created_at);

CREATE TABLE terms_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  document text NOT NULL,
  -- Nulo no rascunho; na publicação recebe o próximo número do documento.
  version integer,
  body_md text NOT NULL,
  requires_reacceptance boolean NOT NULL DEFAULT false,
  effective_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_versions_document_valid CHECK (document IN ('terms', 'privacy')),
  CONSTRAINT terms_versions_version_positive CHECK (version >= 1),
  -- bodyMd de 1 a 100.000 caracteres (spec 030).
  CONSTRAINT terms_versions_body_md_length CHECK (length(body_md) BETWEEN 1 AND 100000),
  -- Rascunho não tem nenhum dos três; publicada tem os três.
  CONSTRAINT terms_versions_publication_matches_version CHECK (
    (version IS NULL) = (published_at IS NULL)
    AND (version IS NULL) = (effective_at IS NULL)
  )
);

-- Número único por documento entre as publicadas; atende também à vigente:
-- WHERE document = $1 AND version IS NOT NULL ORDER BY version DESC LIMIT 1.
CREATE UNIQUE INDEX terms_versions_document_version_unique ON terms_versions (document, version)
  WHERE version IS NOT NULL;

-- Lista do admin (mais nova primeiro, rascunhos inclusos): WHERE document = $1
-- ORDER BY created_at DESC.
CREATE INDEX terms_versions_document_created_idx ON terms_versions (document, created_at);

-- Versão publicada é imutável (RF-01 da spec 030): recusa UPDATE e DELETE dela.
CREATE FUNCTION terms_versions_guard_published() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'terms_versions publicada é imutável' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER terms_versions_guard_update BEFORE UPDATE ON terms_versions
  FOR EACH ROW EXECUTE FUNCTION terms_versions_guard_published();

CREATE TRIGGER terms_versions_guard_delete BEFORE DELETE ON terms_versions
  FOR EACH ROW EXECUTE FUNCTION terms_versions_guard_published();

CREATE TABLE terms_acceptances (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  terms_version_id uuid NOT NULL,
  -- Apagados na exclusão de conta (spec 030); o aceite permanece.
  ip inet,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT terms_acceptances_terms_version_id_fkey FOREIGN KEY (terms_version_id)
    REFERENCES terms_versions (id)
);

-- Um aceite por versão; aceitar de novo não duplica (ON CONFLICT (user_id, terms_version_id)
-- DO NOTHING). Atende também aos aceites do usuário: WHERE user_id = $1.
CREATE UNIQUE INDEX terms_acceptances_user_version_unique
  ON terms_acceptances (user_id, terms_version_id);

-- Chave estrangeira para terms_versions (apagar rascunho confere aceites por aqui).
CREATE INDEX terms_acceptances_terms_version_idx ON terms_acceptances (terms_version_id);

-- migrate:down

DROP TABLE terms_acceptances;
DROP TABLE terms_versions;
DROP FUNCTION terms_versions_guard_published();
DROP TABLE email_outbox;
