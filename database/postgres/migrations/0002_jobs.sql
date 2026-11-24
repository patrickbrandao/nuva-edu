-- 0002: fila de tarefas em segundo plano (spec 005).
-- Dono dos dados: worker. As APIs só inserem, pela função enqueue de packages/core.

-- migrate:up

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Tipo do catálogo da spec 005 ('email.send', 'payment.reconcile_orders', ...).
  type text NOT NULL,
  -- Apenas identificadores; nunca senha, token ou CPF.
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  -- Maior primeiro. Padrão 0; pagamento usa 10.
  priority smallint NOT NULL DEFAULT 0,
  -- Quando pode executar. Tarefa imediata deixa o padrão; nova tentativa adia este campo.
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  -- Unicidade opcional entre tarefas ativas (recorrentes: tipo + janela).
  unique_key text,
  -- Controle de execução: quem pegou, quando, e o último batimento (a cada 30 s).
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT jobs_status_valid CHECK (status IN ('queued', 'running', 'done', 'failed')),
  CONSTRAINT jobs_type_format CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  CONSTRAINT jobs_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT jobs_attempts_range CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT jobs_max_attempts_range CHECK (max_attempts >= 1),
  CONSTRAINT jobs_unique_key_not_empty CHECK (unique_key <> ''),
  -- running tem trava e batimento; queued não tem nenhum dos três (quem devolve à fila limpa).
  -- done e failed guardam a última trava como registro de quem executou.
  CONSTRAINT jobs_lock_matches_status CHECK (
    CASE status
      WHEN 'running' THEN
        locked_by IS NOT NULL AND locked_at IS NOT NULL AND heartbeat_at IS NOT NULL
      WHEN 'queued' THEN
        locked_by IS NULL AND locked_at IS NULL AND heartbeat_at IS NULL
      ELSE true
    END
  ),
  -- finished_at existe se, e só se, a tarefa chegou a um estado final.
  CONSTRAINT jobs_finished_at_matches_status CHECK (
    (status IN ('done', 'failed')) = (finished_at IS NOT NULL)
  )
);

-- Consumo: WHERE status = 'queued' AND run_at <= now()
--          ORDER BY priority DESC, run_at LIMIT n FOR UPDATE SKIP LOCKED.
CREATE INDEX jobs_ready_idx ON jobs (priority DESC, run_at) WHERE status = 'queued';

-- Deduplicação: a mesma unique_key não convive duas vezes entre as tarefas ativas.
-- Uso no enqueue: ON CONFLICT (unique_key) WHERE status IN ('queued', 'running') DO NOTHING.
CREATE UNIQUE INDEX jobs_unique_key_active_unique ON jobs (unique_key)
  WHERE status IN ('queued', 'running');

-- Tarefa presa: running com heartbeat_at antigo volta à fila (RNF-04).
CREATE INDEX jobs_running_heartbeat_idx ON jobs (heartbeat_at) WHERE status = 'running';

-- Retenção (done 7 dias, failed 30 dias) e lista de failed da tela de operações.
CREATE INDEX jobs_finished_idx ON jobs (status, finished_at) WHERE status IN ('done', 'failed');

-- Acorda os workers (LISTEN nuva_jobs). O aviso só é entregue no COMMIT, então tarefa de
-- transação desfeita não acorda ninguém. Sem conteúdo: avisos iguais da mesma transação
-- viram um só, e o worker consulta a fila de qualquer forma.
CREATE FUNCTION jobs_notify() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('nuva_jobs', '');
  RETURN NULL;
END;
$$;

-- Só para tarefa que já pode executar. A agendada para depois é pega pela varredura do worker.
-- clock_timestamp(), e não now(): run_at calculado pela aplicação logo antes do INSERT pode
-- ser posterior ao início da transação.
CREATE TRIGGER jobs_notify_insert AFTER INSERT ON jobs
  FOR EACH ROW
  WHEN (NEW.status = 'queued' AND NEW.run_at <= clock_timestamp())
  EXECUTE FUNCTION jobs_notify();

-- Reenfileirar pela tela de operações, ou antecipar run_at, também acorda.
CREATE TRIGGER jobs_notify_update AFTER UPDATE OF status, run_at ON jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'queued'
    AND NEW.run_at <= clock_timestamp()
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.run_at IS DISTINCT FROM NEW.run_at)
  )
  EXECUTE FUNCTION jobs_notify();

-- migrate:down

DROP TABLE jobs;
DROP FUNCTION jobs_notify();
