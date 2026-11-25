-- 0012: certificados, templates, versões de template e pedidos de exemplo (spec 015, "Dados";
-- ADR 0026; atualização da tarefa 463).
-- Donos dos dados: worker (emissão, PDF e exemplo); admin-api (revogação, emissão manual,
-- templates e pedidos de exemplo). classroom-api lê.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 a 0011; relatadas ao
-- arquiteto na tarefa 408):
-- - Quem fez a ação (issued_by, revoked_by, created_by, updated_by) referencia users sem ação
--   na exclusão: a conta nunca é apagada de fato (030, linha de users com deleted_at), como em
--   user_suspensions e audit_log. Sem índice nessas chaves pelo mesmo motivo.
-- - certificates.user_id sem cascata: o registro permanece depois da exclusão da conta, sem
--   student_name e sem PDF (015, "Retenção"; 030). Por isso student_name é nulo e há CHECK de
--   que certificado sem nome não guarda PDF.
-- - certificates.course_id com ON DELETE RESTRICT: certificado é vínculo do curso (a 009 só
--   exclui curso sem vínculos; a recusa 409 product_has_links é do código, a chave a garante).
-- - code: 12 caracteres do alfabeto da RNF-04 (2-9 e A-Z sem I, L e O), maiúsculas e sem hífen;
--   o hífen e a normalização da busca são do código.
-- - Dados congelados: course_title, hours, completed_at e school_name obrigatórios; hours >= 0
--   (curso sem duração soma 0 hora); student_name, instructor_name, signer_name e signer_role
--   podem ser nulos (titular removido, curso sem dono, signatário não configurado).
-- - issued_manually exige issued_by e issue_reason; issue_reason só existe na emissão manual.
--   issued_by fica nulo na automática. revoked_at, revoked_by e revoke_reason andam juntos
--   (desfazer a revogação limpa os três). Motivos com 1 a 500 caracteres, como na 0010.
-- - pdf e pdf_rendered_at andam juntos; PDF até 2 MiB (RNF-03) também no banco, nos
--   certificados e nos exemplos.
-- - certificates tem created_at e updated_at (gatilho): revogação, reemissão e PDF alteram a
--   linha. Sem version: a spec não pede controle de conflito no certificado.
-- - certificate_template_versions: html de 1 a 786432 bytes (768 KiB por octet_length, RNF-03).
--   Imutável: o gatilho recusa UPDATE, salvo o SET NULL de course_id feito pela chave quando o
--   curso é excluído (a ação da chave é um UPDATE e dispara o gatilho). DELETE é permitido (o
--   expurgo de 30 dias da 033), e as chaves RESTRICT de certificates e certificate_templates
--   impedem apagar versão em uso.
-- - A coerência entre certificate_templates.course_id e o course_id da versão apontada é do
--   código (chave composta não convive com o SET NULL da versão na exclusão do curso).
-- - certificate_templates: UNIQUE (course_id) para os cursos e índice único parcial sobre uma
--   expressão constante WHERE course_id IS NULL, para um só padrão da escola. Sem version: o
--   conflito de gravação compara version_id com o expectedVersionId (015, "Versões").
-- - certificate_previews: status pending | ready | failed; ready tem pdf e rendered_at, failed tem
--   error (1 a 2.000 caracteres), pending nenhum dos três. requested_by em cascata e course_id
--   SET NULL (tarefa 463). html com o mesmo limite das versões.

-- migrate:up

CREATE TABLE certificate_template_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Nulo para o padrão da escola e depois de excluído o curso.
  course_id uuid,
  html text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certificate_template_versions_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE SET NULL,
  CONSTRAINT certificate_template_versions_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES users (id),
  CONSTRAINT certificate_template_versions_html_size CHECK (
    octet_length(html) BETWEEN 1 AND 786432
  )
);

-- Histórico do curso e chave estrangeira (SET NULL na exclusão do curso).
CREATE INDEX certificate_template_versions_course_idx ON certificate_template_versions
  (course_id, created_at) WHERE course_id IS NOT NULL;
-- Expurgo das versões sem uso (033): WHERE created_at < now() - interval '30 days' AND NOT EXISTS.
CREATE INDEX certificate_template_versions_created_idx ON certificate_template_versions
  (created_at);

-- Versão é imutável (015, "Versões"): só passa o SET NULL de course_id da chave estrangeira.
CREATE FUNCTION certificate_template_versions_guard_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.course_id IS NULL
    AND (to_jsonb(OLD) - 'course_id') = (to_jsonb(NEW) - 'course_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'certificate_template_versions é imutável' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER certificate_template_versions_guard_update
  BEFORE UPDATE ON certificate_template_versions
  FOR EACH ROW EXECUTE FUNCTION certificate_template_versions_guard_update();

CREATE TABLE certificate_templates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Nulo = padrão da escola.
  course_id uuid,
  -- Versão atual.
  version_id uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Atende também o template efetivo: WHERE course_id = $1.
  CONSTRAINT certificate_templates_course_unique UNIQUE (course_id),
  CONSTRAINT certificate_templates_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT certificate_templates_version_id_fkey FOREIGN KEY (version_id)
    REFERENCES certificate_template_versions (id) ON DELETE RESTRICT,
  CONSTRAINT certificate_templates_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES users (id)
);

-- Um só padrão da escola: WHERE course_id IS NULL.
CREATE UNIQUE INDEX certificate_templates_school_default_unique ON certificate_templates ((true))
  WHERE course_id IS NULL;
-- Chave estrangeira de version_id (RESTRICT) e expurgo das versões sem uso.
CREATE INDEX certificate_templates_version_idx ON certificate_templates (version_id);

CREATE TRIGGER certificate_templates_set_updated_at BEFORE UPDATE ON certificate_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE certificates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  course_id uuid NOT NULL,
  -- Sem hífen, em maiúsculas; exibido como XXXX-XXXX-XXXX.
  code text NOT NULL,
  -- Dados congelados na emissão (e de novo na reemissão).
  -- Nulo depois que o titular exclui a conta (030).
  student_name text,
  course_title text NOT NULL,
  instructor_name text,
  hours integer NOT NULL,
  completed_at timestamptz NOT NULL,
  school_name text NOT NULL,
  signer_name text,
  signer_role text,
  template_version_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_manually boolean NOT NULL DEFAULT false,
  issued_by uuid,
  issue_reason text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  pdf bytea,
  pdf_rendered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Um por aluno e curso (RF-08); atende também WHERE user_id = $1.
  CONSTRAINT certificates_user_course_unique UNIQUE (user_id, course_id),
  CONSTRAINT certificates_code_unique UNIQUE (code),
  CONSTRAINT certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT certificates_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE RESTRICT,
  CONSTRAINT certificates_template_version_id_fkey FOREIGN KEY (template_version_id)
    REFERENCES certificate_template_versions (id) ON DELETE RESTRICT,
  CONSTRAINT certificates_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES users (id),
  CONSTRAINT certificates_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES users (id),
  -- Alfabeto da RNF-04: sem 0, O, 1, I e L.
  CONSTRAINT certificates_code_format CHECK (code ~ '^[2-9A-HJKMNP-Z]{12}$'),
  CONSTRAINT certificates_course_title_length CHECK (
    btrim(course_title) <> '' AND char_length(course_title) <= 160
  ),
  CONSTRAINT certificates_school_name_length CHECK (btrim(school_name) <> ''),
  CONSTRAINT certificates_hours_range CHECK (hours >= 0),
  CONSTRAINT certificates_manual_issue_complete CHECK (
    (issued_manually = (issue_reason IS NOT NULL))
    AND (NOT issued_manually OR issued_by IS NOT NULL)
  ),
  CONSTRAINT certificates_issue_reason_length CHECK (
    btrim(issue_reason) <> '' AND char_length(issue_reason) <= 500
  ),
  CONSTRAINT certificates_revocation_together CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL)
    AND (revoked_at IS NULL) = (revoke_reason IS NULL)
  ),
  CONSTRAINT certificates_revoke_reason_length CHECK (
    btrim(revoke_reason) <> '' AND char_length(revoke_reason) <= 500
  ),
  CONSTRAINT certificates_pdf_together CHECK ((pdf IS NULL) = (pdf_rendered_at IS NULL)),
  CONSTRAINT certificates_pdf_size CHECK (octet_length(pdf) <= 2097152),
  -- Titular removido: o PDF é apagado junto com o nome (015, "Retenção").
  CONSTRAINT certificates_removed_holder_without_pdf CHECK (
    student_name IS NOT NULL OR pdf IS NULL
  )
);

-- Lista do admin por curso e chave estrangeira de course_id:
-- WHERE course_id = $1 ORDER BY issued_at DESC, id DESC.
CREATE INDEX certificates_course_issued_idx ON certificates (course_id, issued_at DESC, id DESC);
-- Lista do admin sem filtro: ORDER BY issued_at DESC, id DESC.
CREATE INDEX certificates_issued_idx ON certificates (issued_at DESC, id DESC);
-- Chave estrangeira de template_version_id (RESTRICT) e expurgo das versões sem uso.
CREATE INDEX certificates_template_version_idx ON certificates (template_version_id);

CREATE TRIGGER certificates_set_updated_at BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE certificate_previews (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  requested_by uuid NOT NULL,
  -- Curso indicado no pedido; nulo sem curso e depois de excluído o curso.
  course_id uuid,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  pdf bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  rendered_at timestamptz,
  CONSTRAINT certificate_previews_requested_by_fkey FOREIGN KEY (requested_by)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT certificate_previews_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE SET NULL,
  CONSTRAINT certificate_previews_html_size CHECK (octet_length(html) BETWEEN 1 AND 786432),
  CONSTRAINT certificate_previews_status_valid CHECK (status IN ('pending', 'ready', 'failed')),
  CONSTRAINT certificate_previews_ready_has_pdf CHECK (
    (status = 'ready') = (pdf IS NOT NULL)
    AND (status = 'ready') = (rendered_at IS NOT NULL)
  ),
  CONSTRAINT certificate_previews_failed_has_error CHECK ((status = 'failed') = (error IS NOT NULL)),
  CONSTRAINT certificate_previews_error_length CHECK (
    btrim(error) <> '' AND char_length(error) <= 2000
  ),
  CONSTRAINT certificate_previews_pdf_size CHECK (octet_length(pdf) <= 2097152)
);

-- Expurgo de 24 horas (033): WHERE created_at < now() - interval '24 hours'.
CREATE INDEX certificate_previews_created_idx ON certificate_previews (created_at);
-- Limite de 20 por hora (RNF-06) e chave estrangeira de requested_by:
-- WHERE requested_by = $1 AND created_at > now() - interval '1 hour'.
CREATE INDEX certificate_previews_requested_by_created_idx ON certificate_previews
  (requested_by, created_at);
-- Chave estrangeira de course_id (SET NULL na exclusão do curso).
CREATE INDEX certificate_previews_course_idx ON certificate_previews (course_id)
  WHERE course_id IS NOT NULL;

-- migrate:down

DROP TABLE certificate_previews;
DROP TABLE certificates;
DROP TABLE certificate_templates;
DROP TABLE certificate_template_versions;
DROP FUNCTION certificate_template_versions_guard_update();
