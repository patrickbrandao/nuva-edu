-- 0006: registro de auditoria imutável (spec 028).
-- Dono dos dados: admin-api; classroom-api e worker inserem eventos de segurança pela função
-- recordAudit de packages/core. A aplicação só insere; o worker expurga por audit_log_purge.
--
-- Imutabilidade por gatilhos (spec 028, "Imutabilidade"), porque aplicações e migrations usam
-- o mesmo usuário de banco, dono da tabela: UPDATE só para anular ip e user_agent; DELETE só
-- dentro de audit_log_purge; TRUNCATE nunca. Erro P0001 'audit_log é imutável'.
--
-- Decisões de esquema que a spec não fixa (forma mais conservadora; relatadas ao arquiteto):
-- - target_id é text: o alvo pode ser um UUID ou uma chave (settings.update de uma chave).
-- - actor_user_id tem chave estrangeira para users (a linha de users nunca é apagada, spec 030).
--   mcp_key_id ainda não tem: a tabela mcp_keys chega na Fase 5, com a FK.
-- - O índice de ação usa text_pattern_ops: o banco usa colação en_US, e o filtro por prefixo
--   (user.* vira action LIKE 'user.%') só usa índice assim. Ele também atende à igualdade.
-- - O limite de 8 KB de details é aplicado e marcado (truncated) pela recordAudit; o banco não
--   o repete, para não desfazer uma ação por diferença de medida.
-- - Além da marca da transação, o gatilho de DELETE exige que a linha tenha mais de 365 dias,
--   e audit_log_purge desliga a marca ao terminar: nem um SET LOCAL avulso apaga o recente.
-- - audit_log_purge com retention_days nulo ou abaixo de 365 falha com 22023
--   (invalid_parameter_value), para não se confundir com o erro dos gatilhos.

-- migrate:up

CREATE TABLE audit_log (
  -- UUID v7: ordenável por tempo.
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Quem agiu; nulo para worker e cli. Em chamada MCP, o emissor da chave.
  actor_user_id uuid,
  -- Papel do ator no momento da ação.
  actor_role text,
  origin text NOT NULL,
  mcp_key_id uuid,
  -- Código da ação ('user.password_view', 'mcp.tool_call', ...).
  action text NOT NULL,
  target_type text,
  target_id text,
  outcome text NOT NULL,
  -- IP real do cliente (TRUSTED_PROXIES); anulado com user_agent na exclusão de conta.
  ip inet,
  user_agent text,
  -- Mesmo identificador dos logs.
  request_id text,
  -- Antes e depois dos campos alterados; nunca senha, chave, token ou segredo (RF-07).
  details jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT audit_log_actor_role_valid CHECK (
    actor_role IN ('student', 'instructor', 'manager', 'admin')
  ),
  CONSTRAINT audit_log_origin_valid CHECK (
    origin IN ('admin_panel', 'mcp', 'classroom', 'worker', 'cli')
  ),
  CONSTRAINT audit_log_outcome_valid CHECK (outcome IN ('ok', 'denied', 'error')),
  CONSTRAINT audit_log_action_format CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  -- Chave MCP só em registro de origem mcp.
  CONSTRAINT audit_log_mcp_key_matches_origin CHECK (mcp_key_id IS NULL OR origin = 'mcp'),
  -- Alvo identificado só com o tipo.
  CONSTRAINT audit_log_target_matches_type CHECK (target_id IS NULL OR target_type IS NOT NULL),
  CONSTRAINT audit_log_details_object CHECK (jsonb_typeof(details) = 'object')
);

-- Consulta por período (padrão: últimos 30 dias) e expurgo: WHERE created_at >= $from AND
-- created_at < $to ORDER BY created_at DESC; audit_log_purge: WHERE created_at < $corte.
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);

-- Filtro por ator: WHERE actor_user_id = $1 AND created_at ... ORDER BY created_at DESC.
CREATE INDEX audit_log_actor_created_idx ON audit_log (actor_user_id, created_at);

-- Filtro por alvo: WHERE target_type = $1 AND target_id = $2 AND created_at ...
CREATE INDEX audit_log_target_created_idx ON audit_log (target_type, target_id, created_at);

-- Filtro por ação exata (action = $1) ou por prefixo (action LIKE 'user.%').
CREATE INDEX audit_log_action_created_idx ON audit_log (action text_pattern_ops, created_at);

-- Filtro por chave MCP: WHERE mcp_key_id = $1 AND created_at ...
CREATE INDEX audit_log_mcp_key_created_idx ON audit_log (mcp_key_id, created_at);

-- UPDATE só quando a única mudança é ip e user_agent passando a nulo (anonimização, spec 030).
-- A comparação por jsonb cobre também colunas que vierem depois.
CREATE FUNCTION audit_log_guard_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ip IS NULL
    AND NEW.user_agent IS NULL
    AND (to_jsonb(OLD) - 'ip' - 'user_agent') = (to_jsonb(NEW) - 'ip' - 'user_agent')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log é imutável' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER audit_log_guard_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard_update();

-- DELETE só dentro de audit_log_purge (marca nuva.audit_purge da transação) e só de linha com
-- mais de 365 dias, o menor prazo que a função aceita.
CREATE FUNCTION audit_log_guard_delete() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('nuva.audit_purge', true) = 'on'
    AND OLD.created_at < now() - interval '365 days'
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log é imutável' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER audit_log_guard_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard_delete();

CREATE FUNCTION audit_log_guard_truncate() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é imutável' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER audit_log_guard_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard_truncate();

-- Expurgo diário do worker (RNF-01, NUVA_RETENTION_AUDIT_DAYS, padrão 730):
-- SELECT audit_log_purge($1). Apaga em lotes de 5.000 o que passou do prazo e devolve o total.
CREATE FUNCTION audit_log_purge(retention_days integer) RETURNS bigint
  LANGUAGE plpgsql
AS $$
DECLARE
  cutoff timestamptz;
  batch bigint;
  total bigint := 0;
BEGIN
  IF retention_days IS NULL OR retention_days < 365 THEN
    RAISE EXCEPTION 'audit_log_purge: retention_days deve ser pelo menos 365 (recebido: %)',
      retention_days
      USING ERRCODE = '22023';
  END IF;
  cutoff := now() - make_interval(days => retention_days);

  SET LOCAL nuva.audit_purge = 'on';
  LOOP
    DELETE FROM audit_log
     WHERE id IN (
       SELECT id FROM audit_log WHERE created_at < cutoff ORDER BY created_at LIMIT 5000
     );
    GET DIAGNOSTICS batch = ROW_COUNT;
    total := total + batch;
    EXIT WHEN batch < 5000;
  END LOOP;
  SET LOCAL nuva.audit_purge = 'off';

  RETURN total;
END;
$$;

-- migrate:down

DROP TABLE audit_log;
DROP FUNCTION audit_log_purge(integer);
DROP FUNCTION audit_log_guard_truncate();
DROP FUNCTION audit_log_guard_delete();
DROP FUNCTION audit_log_guard_update();
