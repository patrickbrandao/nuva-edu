-- 0011: progresso, atividade (spec 014, "Dados") e anotações (spec 016, "Dados").
-- Dono dos dados: classroom-api escreve; admin-api lê o progresso (nunca as notas).
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 e da 0010; relatadas ao
-- arquiteto na tarefa 407):
-- - user_id com ON DELETE CASCADE nas três tabelas: progresso, atividade e notas são apagados na
--   exclusão da conta (014 e 016, "Retenção").
-- - lesson_progress: lesson_id e course_id com ON DELETE CASCADE (progresso de aula excluída não
--   entra em cálculo nenhum). A coerência de course_id com o curso da aula é do código (lessons
--   não tem course_id; a aula só muda de módulo dentro do próprio curso).
-- - lesson_progress: a linha nasce ao abrir ou gravar a aula, então first_opened_at e
--   last_opened_at são obrigatórios (padrão now()) e first_opened_at faz o papel de created_at;
--   updated_at pelo gatilho. position_seconds começa em 0; o teto (duração + 60 s) é do código.
--   completed_at e completed_via andam juntos. Sem version: a spec não pede controle de conflito.
-- - activity_days: total é coluna gerada (soma dos três contadores), para nunca divergir; os
--   contadores começam em 0 e nunca ficam negativos. Sem created_at e updated_at: é um contador.
-- - notes: lesson_id e course_id com ON DELETE SET NULL; a nota de aula continua nota de aula pelos
--   títulos guardados (lesson_title_snapshot e course_title_snapshot andam juntos e são
--   obrigatórios enquanto houver lesson_id ou course_id). O filtro "de aulas" × "avulsas" é
--   lesson_title_snapshot IS NOT NULL, não lesson_id. video_seconds só em nota de aula.
-- - notes: corpo obrigatório com algum caractere não branco (nota vazia não é salva, 016) e até
--   20.000 caracteres; título opcional, não vazio quando presente, até 160. O limite de 5.000
--   notas por usuário é do código.
-- - notes: created_at e updated_at em timestamptz(3). O controle de conflito compara o updated_at
--   que o cliente envia (JSON, precisão de milissegundos) com o do banco; com microssegundos a
--   comparação nunca bateria.
-- - notes.search: configuração 'portuguese' constante (coluna gerada exige, 016, "Página
--   Anotações"), título com peso A e corpo com peso B, sem unaccent (não é imutável). Outro
--   idioma pede migration.
-- - Índices da spec com desempate para paginação por cursor: (user_id, updated_at DESC, id DESC)
--   e (user_id, lesson_id, created_at) para a aba da aula, da mais antiga à mais recente. Índices
--   parciais em lesson_id e course_id atendem o SET NULL na exclusão de aula e curso.

-- migrate:up

CREATE TABLE lesson_progress (
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  -- Redundante de propósito: estante sem junção com módulos (spec 014).
  course_id uuid NOT NULL,
  first_opened_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  position_seconds integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  completed_via text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_progress_pkey PRIMARY KEY (user_id, lesson_id),
  CONSTRAINT lesson_progress_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT lesson_progress_lesson_id_fkey FOREIGN KEY (lesson_id)
    REFERENCES lessons (id) ON DELETE CASCADE,
  CONSTRAINT lesson_progress_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT lesson_progress_position_seconds_range CHECK (position_seconds >= 0),
  CONSTRAINT lesson_progress_opened_order CHECK (last_opened_at >= first_opened_at),
  CONSTRAINT lesson_progress_completed_via_valid CHECK (
    completed_via IN ('manual', 'video_end')
  ),
  CONSTRAINT lesson_progress_completed_together CHECK (
    (completed_at IS NULL) = (completed_via IS NULL)
  )
);

-- Estante e progresso do curso: WHERE user_id = $1 AND course_id = ANY($2).
CREATE INDEX lesson_progress_user_course_idx ON lesson_progress (user_id, course_id);
-- "Continuar" e "Continue assistindo": WHERE user_id = $1 ORDER BY last_opened_at DESC.
CREATE INDEX lesson_progress_user_last_opened_idx ON lesson_progress (user_id, last_opened_at DESC);
-- Resumo do curso no admin (faixas e alunos) e chave estrangeira de course_id.
CREATE INDEX lesson_progress_course_idx ON lesson_progress (course_id);
-- Chave estrangeira de lesson_id (exclusão da aula).
CREATE INDEX lesson_progress_lesson_idx ON lesson_progress (lesson_id);

CREATE TRIGGER lesson_progress_set_updated_at BEFORE UPDATE ON lesson_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE activity_days (
  user_id uuid NOT NULL,
  -- Data no fuso do usuário (spec 014, "Meu progresso e mapa de atividade").
  day date NOT NULL,
  lessons_completed integer NOT NULL DEFAULT 0,
  -- Passa a contar na Fase 4 (fórum).
  forum_posts integer NOT NULL DEFAULT 0,
  -- Passa a contar na Fase 6 (comunidade).
  community_actions integer NOT NULL DEFAULT 0,
  total integer NOT NULL GENERATED ALWAYS AS (lessons_completed + forum_posts + community_actions) STORED,
  -- Mapa de 12 meses: WHERE user_id = $1 AND day BETWEEN $2 AND $3.
  CONSTRAINT activity_days_pkey PRIMARY KEY (user_id, day),
  CONSTRAINT activity_days_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT activity_days_lessons_completed_range CHECK (lessons_completed >= 0),
  CONSTRAINT activity_days_forum_posts_range CHECK (forum_posts >= 0),
  CONSTRAINT activity_days_community_actions_range CHECK (community_actions >= 0)
);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  -- Nulo nas avulsas e depois de excluída a aula.
  lesson_id uuid,
  -- Redundante, para o filtro por curso; nulo nas avulsas e depois de excluído o curso.
  course_id uuid,
  -- Títulos no momento da criação; presentes em toda nota de aula, mesmo sem a aula.
  lesson_title_snapshot text,
  course_title_snapshot text,
  video_seconds integer,
  title text,
  -- Markdown restrito (spec 016, "Edição").
  body text NOT NULL,
  search tsvector NOT NULL GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese'::regconfig, coalesce(title, '')), 'A')
      || setweight(to_tsvector('portuguese'::regconfig, body), 'B')
  ) STORED,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT notes_lesson_id_fkey FOREIGN KEY (lesson_id)
    REFERENCES lessons (id) ON DELETE SET NULL,
  CONSTRAINT notes_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE SET NULL,
  CONSTRAINT notes_snapshots_together CHECK (
    (lesson_title_snapshot IS NULL) = (course_title_snapshot IS NULL)
  ),
  CONSTRAINT notes_lesson_has_snapshot CHECK (
    (lesson_id IS NULL AND course_id IS NULL) OR lesson_title_snapshot IS NOT NULL
  ),
  CONSTRAINT notes_lesson_title_snapshot_length CHECK (
    char_length(lesson_title_snapshot) <= 160
  ),
  CONSTRAINT notes_course_title_snapshot_length CHECK (
    char_length(course_title_snapshot) <= 160
  ),
  CONSTRAINT notes_video_seconds_range CHECK (video_seconds >= 0),
  CONSTRAINT notes_video_seconds_lesson_only CHECK (
    video_seconds IS NULL OR lesson_title_snapshot IS NOT NULL
  ),
  CONSTRAINT notes_title_length CHECK (title ~ '\S' AND char_length(title) <= 160),
  CONSTRAINT notes_body_length CHECK (body ~ '\S' AND char_length(body) <= 20000)
);

-- Página "Anotações": WHERE user_id = $1 ORDER BY updated_at DESC, id DESC (cursor).
CREATE INDEX notes_user_updated_idx ON notes (user_id, updated_at DESC, id DESC);
-- Aba "Minhas notas": WHERE user_id = $1 AND lesson_id = $2 ORDER BY created_at.
CREATE INDEX notes_user_lesson_idx ON notes (user_id, lesson_id, created_at);
-- Busca: search @@ plainto_tsquery('portuguese', $1).
CREATE INDEX notes_search_idx ON notes USING gin (search);
-- Chaves estrangeiras (SET NULL na exclusão da aula e do curso).
CREATE INDEX notes_lesson_idx ON notes (lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX notes_course_idx ON notes (course_id) WHERE course_id IS NOT NULL;

CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE notes;
DROP TABLE activity_days;
DROP TABLE lesson_progress;
