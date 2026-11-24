-- 0003: índice em jobs.unique_key para as recorrentes (spec 005) e sequência dos eventos de
-- usuário do SSE (spec 004).

-- migrate:up

-- Recorrente: a chave inclui a janela ('retention.purge:2026-11-24') e o núcleo só insere se
-- não houver tarefa com a mesma chave em QUALQUER estado. jobs_unique_key_active_unique só
-- cobre queued e running, então não atende a esta consulta:
--   WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE unique_key = $1)
-- Parcial: a maioria das tarefas não tem chave. O "=" já implica IS NOT NULL para o planejador.
CREATE INDEX jobs_unique_key_idx ON jobs (unique_key) WHERE unique_key IS NOT NULL;

-- Numera os eventos publicados em nuva_user_events: o `id` crescente do SSE, que o navegador
-- devolve em Last-Event-ID. Uma sequência só, para todos os usuários e todas as instâncias da
-- API: crescente por usuário, com saltos. Uso: nextval('user_event_id_seq').
-- Sequência não volta atrás em ROLLBACK; número pulado não é evento perdido.
CREATE SEQUENCE user_event_id_seq AS bigint;

-- migrate:down

DROP SEQUENCE user_event_id_seq;
DROP INDEX jobs_unique_key_idx;
