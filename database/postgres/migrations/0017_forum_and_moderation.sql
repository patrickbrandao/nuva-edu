-- 0017: fórum (spec 017, "Dados" e "Comportamento") e moderação (spec 026, "Dados").
-- Donos dos dados: forum_categories, a admin-api nas livres e a publicação do curso na
-- automática; forum_topics, forum_posts, reactions e forum_topic_follows, a classroom-api (a
-- admin-api modera tópicos e respostas); reports, a classroom-api na criação e a admin-api na
-- resolução; moderation_actions, a admin-api. O worker só oculta o conteúdo ao atingir o limite
-- de denunciantes distintos (026, RNF-02) e notifica a equipe.
-- Reutiliza users e user_suspensions (0005), courses/modules/lessons (0009), settings (0001) e
-- audit_log (0006): esta migration não cria infraestrutura de suspensão, catálogo, limites nem
-- auditoria.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 a 0016; relatadas ao
-- arquiteto na tarefa 571):
-- - Markdown saneado persistido (ADR 0027): tópicos e respostas sempre gravam body_md e
--   body_html na mesma transação; o HTML é o saneado do servidor, nunca o do cliente. Nada de
--   reescrita de conteúdo anterior: fórum nasce já neste formato.
-- - Uma categoria por curso: índice único parcial em course_id (inclusive arquivada), porque
--   excluir um curso arquiva a categoria (017) e a categoria arquivada pode sobreviver ao curso
--   — por isso a chave estrangeira é ON DELETE SET NULL e kind 'course' aceita course_id nulo,
--   que só aparece na categoria do curso excluído (o código a arquiva na mesma transação).
--   audience só vale para categoria livre; categoria de curso fica com 'all' (o acesso é o
--   direito ao curso) e o CHECK recusa outro valor.
-- - Estado do tópico: status é open/closed e a ocultação é ortogonal (hidden_at/hidden_by, como
--   a spec 026 nomeia as colunas). A API expõe o estado "hidden" quando hidden_at está
--   preenchido; reexibir um tópico fechado o devolve fechado, sem perder o estado. Tópicos
--   automáticos de aula e respostas compartilham o par hidden_at/hidden_by, e hidden_by fica
--   nulo na ocultação automática pelo limite de denunciantes (não houve moderador).
-- - solved é derivado de solution_post_id (a spec 017 não pede coluna própria) e o tópico
--   automático de aula não aceita solução. A solução precisa ser resposta do próprio tópico:
--   gatilho, porque a checagem é entre tabelas. Excluir a solução desfaz o "resolvido"
--   (ON DELETE SET NULL).
-- - Tópico automático de aula não tem autor (exibido como "Equipe") e o título espelha o da
--   aula. O banco garante o que sobrevive à exclusão da aula (título não vazio e até 160
--   caracteres, teto de lessons) e o corpo de até 20.000 caracteres; a faixa da RNF-02 (5 a 150)
--   nos tópicos livres e a obrigatoriedade de autor nos tópicos de aluno ficam no código, porque
--   excluir a aula deixa o tópico sem lesson_id e sem autor. O corpo do automático é montado
--   dentro do limite pelo núcleo.
-- - lesson_id é único (um tópico por aula, RF-02) e ON DELETE SET NULL: excluir a aula mantém a
--   publicação no fórum, agora sem vínculo com a aula e sem autor, na categoria arquivada do
--   curso (a exibição é do código). O atalho lessons.forum_topic_id (0009) recebe aqui a chave
--   estrangeira prometida; as duas colunas são mantidas juntas pelo código e as unicidades
--   parciais impedem dois tópicos para a mesma aula ou duas aulas para o mesmo tópico.
-- - Post e resposta em um nível (017): gatilho recusa pai que já seja resposta e pai de outro
--   tópico. A chave do pai é NO ACTION: apagar a resposta com dependentes é recusado, porque a
--   exclusão pelo autor troca o corpo pelo texto fixo e mantém a linha.
-- - deleted_at em tópico e resposta: exclusão pelo autor com dependentes mantém a linha com o
--   corpo substituto; sem dependentes a linha pode ser apagada (017).
-- - posts_count e last_activity_at do tópico são mantidos pelo código (dependem de outra
--   tabela); o banco só garante o começo coerente (0 e now()) e o não negativo.
-- - Reações: alvo polimórfico sem chave estrangeira (conferido pelo código, como
--   notifications.target_id), um registro por usuário, alvo e emoji (chave primária) e o
--   conjunto fixo de seis emojis da 017; gatilho apaga as reações do alvo removido. A Fase 6
--   acrescenta 'case' ao target_type em migration própria, quando a 022 chegar.
-- - Seguidores: chave primária (topic_id, user_id); a chave de users é sem cascata como nas
--   demais tabelas (a linha de users nunca é apagada, spec 030) e a exclusão de conta apaga as
--   linhas explicitamente.
-- - Denúncias: reporter_id é anulável porque a exclusão de conta mantém a denúncia sem o
--   denunciante (026 e 030). A unicidade por denunciante e conteúdo (RNF-01) sai num índice
--   único; com reporter_id nulo, denúncias anonimizadas não disputam entre si. 'other' exige
--   details (026); context só existe para target_type 'message' (as até 10 mensagens antes e
--   depois, spec 021) e é objeto JSON. resolved_by, resolved_at e resolution andam juntos e só
--   fora de 'open'; resolution guarda a nota interna da análise (o denunciante só vê
--   "analisada", 026). O limite de 20 por dia fica no código (settings).
-- - moderation_actions registra as oito ações da 026 mais 'unsuspend' (o endpoint de levantamento
--   também é ato de moderação); target_user_id é o autor do conteúdo ou o usuário suspenso e é
--   obrigatório. As ações sobre conta usam target_type 'user' com target_id = target_user_id e
--   exigem motivo; a auditoria imutável continua em audit_log (028), que recebe também a versão
--   original do texto editado pela moderação.
-- - Retenção (033): denúncias resolvidas, ações de moderação e suspensões por 2 anos, com
--   índices próprios de expurgo; o conteúdo do fórum é permanente.

-- migrate:up

CREATE TABLE forum_categories (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- 'course': automática, uma por curso; 'free': criada pela equipe (017, RF-03).
  kind text NOT NULL,
  -- courses.id na automática; nulo na livre e na automática de curso já excluído e arquivada.
  course_id uuid,
  -- Público da categoria livre; ignorado na de curso (sempre 'all').
  audience text NOT NULL DEFAULT 'all',
  name text NOT NULL,
  -- Texto simples, exibido na lista de categorias (não é Markdown da ADR 0027).
  description text,
  -- Ordem das categorias na lista; empate desempata por created_at e id.
  position integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forum_categories_kind_valid CHECK (kind IN ('course', 'free')),
  CONSTRAINT forum_categories_audience_valid CHECK (audience IN ('all', 'active')),
  CONSTRAINT forum_categories_name_length CHECK (
    btrim(name) <> '' AND char_length(name) <= 160
  ),
  CONSTRAINT forum_categories_description_length CHECK (char_length(description) <= 2000),
  CONSTRAINT forum_categories_position_range CHECK (position >= 0),
  -- Livre não tem curso; de curso pode ficar sem o vínculo quando o curso é excluído
  -- (ON DELETE SET NULL); o código arquiva a categoria na mesma transação.
  CONSTRAINT forum_categories_course_matches_kind CHECK (
    kind = 'course' OR course_id IS NULL
  ),
  CONSTRAINT forum_categories_course_audience CHECK (kind <> 'course' OR audience = 'all'),
  CONSTRAINT forum_categories_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE SET NULL
);

-- RF-01: exatamente uma categoria por curso, arquivada ou não.
CREATE UNIQUE INDEX forum_categories_course_unique
  ON forum_categories (course_id) WHERE course_id IS NOT NULL;

CREATE TRIGGER forum_categories_set_updated_at BEFORE UPDATE ON forum_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE forum_topics (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  category_id uuid NOT NULL,
  -- lessons.id no tópico automático de aula; nulo no tópico livre (RF-02).
  lesson_id uuid,
  -- Nulo no tópico automático (exibido como "Equipe") e no que resta dele ao excluir a aula; o
  -- código exige autor nos tópicos criados por aluno.
  author_id uuid,
  title text NOT NULL,
  -- Markdown saneado e HTML correspondente, gravados juntos (ADR 0027).
  body_md text NOT NULL,
  body_html text NOT NULL,
  -- open: aceita resposta; closed: não aceita. Ocultação é hidden_at, não um estado.
  status text NOT NULL DEFAULT 'open',
  pinned boolean NOT NULL DEFAULT false,
  -- Resposta escolhida como solução; solved é derivado daqui.
  solution_post_id uuid,
  posts_count integer NOT NULL DEFAULT 0,
  hidden_at timestamptz,
  hidden_by uuid,
  edited_at timestamptz,
  edited_by uuid,
  deleted_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forum_topics_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES forum_categories (id) ON DELETE CASCADE,
  CONSTRAINT forum_topics_lesson_id_fkey FOREIGN KEY (lesson_id)
    REFERENCES lessons (id) ON DELETE SET NULL,
  CONSTRAINT forum_topics_author_id_fkey FOREIGN KEY (author_id) REFERENCES users (id),
  CONSTRAINT forum_topics_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES users (id),
  CONSTRAINT forum_topics_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES users (id),
  CONSTRAINT forum_topics_title_length CHECK (
    btrim(title) <> '' AND char_length(title) <= 160
  ),
  CONSTRAINT forum_topics_body_md_length CHECK (
    btrim(body_md) <> '' AND char_length(body_md) <= 20000
  ),
  CONSTRAINT forum_topics_body_html_not_empty CHECK (body_html <> ''),
  CONSTRAINT forum_topics_status_valid CHECK (status IN ('open', 'closed')),
  -- Ocultação e autoria da ocultação andam juntas; nula a segunda na ocultação automática.
  CONSTRAINT forum_topics_hidden_matches_by CHECK ((hidden_at IS NULL) = (hidden_by IS NULL)),
  CONSTRAINT forum_topics_edited_matches_by CHECK ((edited_at IS NULL) = (edited_by IS NULL)),
  -- Tópico automático de aula não tem estado de resolvido (017).
  CONSTRAINT forum_topics_lesson_has_no_solution CHECK (
    lesson_id IS NULL OR solution_post_id IS NULL
  ),
  CONSTRAINT forum_topics_posts_count_range CHECK (posts_count >= 0)
);

-- RF-02: um tópico por aula.
CREATE UNIQUE INDEX forum_topics_lesson_unique
  ON forum_topics (lesson_id) WHERE lesson_id IS NOT NULL;

-- Lista da categoria: fixados primeiro, depois por última atividade (017). Desempate por id
-- para a paginação por cursor.
CREATE INDEX forum_topics_category_activity_idx
  ON forum_topics (category_id, pinned DESC, last_activity_at DESC, id DESC);

-- Filtro "sem resposta".
CREATE INDEX forum_topics_unanswered_idx
  ON forum_topics (category_id, last_activity_at DESC)
  WHERE deleted_at IS NULL AND posts_count = 0;

-- Filtro "resolvidos".
CREATE INDEX forum_topics_solved_idx
  ON forum_topics (category_id, last_activity_at DESC)
  WHERE deleted_at IS NULL AND solution_post_id IS NOT NULL;

-- Perfil de terceiros e limite de 10 tópicos por hora:
-- WHERE author_id = $1 [AND created_at > now() - interval '1 hour'].
CREATE INDEX forum_topics_author_created_idx ON forum_topics (author_id, created_at DESC);

-- Listagem de moderação: WHERE hidden_at IS NOT NULL ORDER BY hidden_at DESC.
CREATE INDEX forum_topics_hidden_idx ON forum_topics (hidden_at DESC)
  WHERE hidden_at IS NOT NULL;

-- RF-08: busca por título e corpo, sempre filtrada pelas categorias que o usuário pode ler.
CREATE INDEX forum_topics_title_trgm_idx ON forum_topics USING gin (title gin_trgm_ops);
CREATE INDEX forum_topics_body_trgm_idx ON forum_topics USING gin (body_md gin_trgm_ops);

-- Chave estrangeira de solution_post_id (SET NULL ao apagar a resposta).
CREATE INDEX forum_topics_solution_idx ON forum_topics (solution_post_id)
  WHERE solution_post_id IS NOT NULL;

CREATE TRIGGER forum_topics_set_updated_at BEFORE UPDATE ON forum_topics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE forum_posts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  topic_id uuid NOT NULL,
  -- Resposta em um nível: nulo é resposta ao tópico; preenchido aponta para uma resposta ao
  -- tópico (o gatilho abaixo recusa aninhar além disso).
  parent_post_id uuid,
  author_id uuid NOT NULL,
  body_md text NOT NULL,
  body_html text NOT NULL,
  edited_at timestamptz,
  edited_by uuid,
  deleted_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forum_posts_topic_id_fkey FOREIGN KEY (topic_id)
    REFERENCES forum_topics (id) ON DELETE CASCADE,
  -- NO ACTION: apagar a resposta com dependentes é recusado; a exclusão do autor troca o corpo.
  CONSTRAINT forum_posts_parent_post_id_fkey FOREIGN KEY (parent_post_id)
    REFERENCES forum_posts (id),
  CONSTRAINT forum_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES users (id),
  CONSTRAINT forum_posts_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES users (id),
  CONSTRAINT forum_posts_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES users (id),
  CONSTRAINT forum_posts_body_md_length CHECK (
    btrim(body_md) <> '' AND char_length(body_md) <= 20000
  ),
  CONSTRAINT forum_posts_body_html_not_empty CHECK (body_html <> ''),
  CONSTRAINT forum_posts_hidden_matches_by CHECK ((hidden_at IS NULL) = (hidden_by IS NULL)),
  CONSTRAINT forum_posts_edited_matches_by CHECK ((edited_at IS NULL) = (edited_by IS NULL)),
  CONSTRAINT forum_posts_self_parent CHECK (parent_post_id IS NULL OR parent_post_id <> id)
);

-- Leitura do tópico: WHERE topic_id = $1 ORDER BY created_at, id.
CREATE INDEX forum_posts_topic_created_idx ON forum_posts (topic_id, created_at, id);

-- Respostas de uma resposta (agrupamento por pai) e chave estrangeira do pai.
CREATE INDEX forum_posts_parent_idx ON forum_posts (parent_post_id)
  WHERE parent_post_id IS NOT NULL;

-- Limite de 60 respostas por hora: WHERE author_id = $1 AND created_at > now() - interval '1 hour'.
CREATE INDEX forum_posts_author_created_idx ON forum_posts (author_id, created_at DESC);

-- Listagem de moderação: WHERE hidden_at IS NOT NULL ORDER BY hidden_at DESC.
CREATE INDEX forum_posts_hidden_idx ON forum_posts (hidden_at DESC) WHERE hidden_at IS NOT NULL;

-- RF-08: busca no corpo das respostas, filtrada pelas categorias legíveis.
CREATE INDEX forum_posts_body_trgm_idx ON forum_posts USING gin (body_md gin_trgm_ops);

CREATE TRIGGER forum_posts_set_updated_at BEFORE UPDATE ON forum_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Um nível de aninhamento (017): o pai é resposta ao tópico, não resposta de resposta, e
-- pertence ao mesmo tópico.
CREATE FUNCTION forum_posts_single_level() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  parent_topic uuid;
  grandparent uuid;
BEGIN
  IF NEW.parent_post_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT topic_id, parent_post_id INTO parent_topic, grandparent
    FROM forum_posts WHERE id = NEW.parent_post_id;
  -- Pai inexistente: a chave estrangeira responde.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'forum_posts: resposta de resposta não é permitida'
      USING ERRCODE = '23514', CONSTRAINT = 'forum_posts_parent_single_level';
  END IF;
  IF parent_topic <> NEW.topic_id THEN
    RAISE EXCEPTION 'forum_posts: a resposta pertence a outro tópico'
      USING ERRCODE = '23514', CONSTRAINT = 'forum_posts_parent_same_topic';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER forum_posts_single_level
  BEFORE INSERT OR UPDATE OF parent_post_id, topic_id ON forum_posts
  FOR EACH ROW EXECUTE FUNCTION forum_posts_single_level();

-- A solução do tópico é resposta dele (017): a checagem atravessa tabelas, então é gatilho.
CREATE FUNCTION forum_topics_guard_solution() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.solution_post_id IS NOT NULL THEN
    PERFORM 1 FROM forum_posts
      WHERE id = NEW.solution_post_id AND topic_id = NEW.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forum_topics: a solução precisa ser resposta do próprio tópico'
        USING ERRCODE = '23514', CONSTRAINT = 'forum_topics_solution_in_topic';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER forum_topics_guard_solution
  BEFORE INSERT OR UPDATE OF solution_post_id ON forum_topics
  FOR EACH ROW EXECUTE FUNCTION forum_topics_guard_solution();

-- Fecha a chave estrangeira prometida na 0009 para o atalho que o player lê.
ALTER TABLE forum_topics
  ADD CONSTRAINT forum_topics_solution_post_id_fkey FOREIGN KEY (solution_post_id)
    REFERENCES forum_posts (id) ON DELETE SET NULL;

ALTER TABLE lessons
  ADD CONSTRAINT lessons_forum_topic_id_fkey FOREIGN KEY (forum_topic_id)
    REFERENCES forum_topics (id) ON DELETE SET NULL;

-- Uma aula por tópico, como RF-02.
CREATE UNIQUE INDEX lessons_forum_topic_unique ON lessons (forum_topic_id)
  WHERE forum_topic_id IS NOT NULL;

-- Reações (017): conjunto fixo de seis emojis, uma de cada por usuário e publicação.
CREATE TABLE reactions (
  -- 'forum_topic' ou 'forum_post' nesta fase; a Fase 6 acrescenta 'case'.
  target_type text NOT NULL,
  -- forum_topics.id ou forum_posts.id, conforme target_type; sem chave estrangeira
  -- (polimórfico, conferido pelo código).
  target_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reactions_pkey PRIMARY KEY (target_type, target_id, user_id, emoji),
  CONSTRAINT reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT reactions_target_type_valid CHECK (target_type IN ('forum_topic', 'forum_post')),
  CONSTRAINT reactions_emoji_valid CHECK (emoji IN ('👍', '❤️', '🎉', '😄', '🤔', '👀'))
);

-- Reação não sobrevive ao alvo, mesmo sendo polimórfica: apagar o tópico ou a resposta (inclusive
-- pela cascata da categoria) apaga as reações dele.
CREATE FUNCTION forum_reactions_cleanup() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'forum_topics' THEN
    DELETE FROM reactions WHERE target_type = 'forum_topic' AND target_id = OLD.id;
  ELSE
    DELETE FROM reactions WHERE target_type = 'forum_post' AND target_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER forum_topics_delete_reactions AFTER DELETE ON forum_topics
  FOR EACH ROW EXECUTE FUNCTION forum_reactions_cleanup();

CREATE TRIGGER forum_posts_delete_reactions AFTER DELETE ON forum_posts
  FOR EACH ROW EXECUTE FUNCTION forum_reactions_cleanup();

-- Seguidores do tópico (RF-07): quem cria ou responde passa a seguir; ON CONFLICT DO NOTHING.
CREATE TABLE forum_topic_follows (
  topic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forum_topic_follows_pkey PRIMARY KEY (topic_id, user_id),
  CONSTRAINT forum_topic_follows_topic_id_fkey FOREIGN KEY (topic_id)
    REFERENCES forum_topics (id) ON DELETE CASCADE,
  CONSTRAINT forum_topic_follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Filtro "que eu sigo": WHERE user_id = $1, juntando com forum_topics.
CREATE INDEX forum_topic_follows_user_idx ON forum_topic_follows (user_id, topic_id);

-- Denúncias (026, RF-01 e RNF-01).
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Nulo na denúncia anonimizada pela exclusão de conta (030: permanece sem o denunciante).
  reporter_id uuid,
  target_type text NOT NULL,
  -- Id do conteúdo denunciado; 'profile' aponta para users.id. Sem chave estrangeira.
  target_id uuid NOT NULL,
  reason text NOT NULL,
  -- Descrição opcional, obrigatória em 'other'.
  details text,
  -- Até 10 mensagens antes e 10 depois, só para target_type 'message' (021 e 026).
  context jsonb,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  -- Nota interna da análise; o denunciante vê só "analisada".
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users (id),
  CONSTRAINT reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users (id),
  CONSTRAINT reports_target_type_valid CHECK (
    target_type IN ('forum_topic', 'forum_post', 'case', 'case_comment', 'profile', 'message')
  ),
  CONSTRAINT reports_reason_valid CHECK (
    reason IN ('spam', 'harassment', 'inappropriate', 'piracy', 'personal_data', 'other')
  ),
  CONSTRAINT reports_status_valid CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT reports_other_requires_details CHECK (
    reason <> 'other' OR btrim(coalesce(details, '')) <> ''
  ),
  CONSTRAINT reports_details_length CHECK (char_length(details) <= 2000),
  CONSTRAINT reports_context_only_messages CHECK (context IS NULL OR target_type = 'message'),
  CONSTRAINT reports_context_object CHECK (context IS NULL OR jsonb_typeof(context) = 'object'),
  CONSTRAINT reports_resolution_length CHECK (char_length(resolution) <= 2000),
  -- Resolução completa: os três campos juntos e só fora de 'open'.
  CONSTRAINT reports_resolution_matches_status CHECK (
    (resolved_by IS NULL) = (resolved_at IS NULL)
    AND (resolved_at IS NULL) = (resolution IS NULL)
    AND (status = 'open') = (resolved_at IS NULL)
  ),
  CONSTRAINT reports_resolution_not_empty CHECK (
    resolution IS NULL OR btrim(resolution) <> ''
  )
);

-- RNF-01: uma denúncia por usuário e conteúdo. Denúncia repetida vira ON CONFLICT DO NOTHING;
-- anonimizada (reporter_id nulo) não disputa com as demais.
CREATE UNIQUE INDEX reports_reporter_content_unique
  ON reports (reporter_id, target_type, target_id);

-- Fila agrupada por conteúdo, com contagem de denunciantes e data mais antiga:
-- WHERE status = 'open' GROUP BY target_type, target_id ORDER BY count(*) DESC, min(created_at).
CREATE INDEX reports_open_target_idx
  ON reports (target_type, target_id, created_at) WHERE status = 'open';

-- "Minhas denúncias" e limite de 20 por dia:
-- WHERE reporter_id = $1 [AND created_at > now() - interval '1 day'] ORDER BY created_at DESC.
CREATE INDEX reports_reporter_created_idx ON reports (reporter_id, created_at DESC);

-- Expurgo das resolvidas (2 anos): WHERE resolved_at < now() - interval '2 years'.
CREATE INDEX reports_resolved_retention_idx ON reports (resolved_at)
  WHERE resolved_at IS NOT NULL;

CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ações de moderação (026, RF-03 e RF-06). audit_log continua sendo o registro imutável (028).
CREATE TABLE moderation_actions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  moderator_id uuid NOT NULL,
  -- 'dismiss', 'hide', 'unhide', 'edit', 'close', 'clear_profile', 'warn', 'suspend' e
  -- 'unsuspend'.
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  -- Autor do conteúdo ou usuário alvo da ação sobre conta; obrigatório.
  target_user_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_actions_moderator_id_fkey FOREIGN KEY (moderator_id)
    REFERENCES users (id),
  CONSTRAINT moderation_actions_target_user_id_fkey FOREIGN KEY (target_user_id)
    REFERENCES users (id),
  CONSTRAINT moderation_actions_action_valid CHECK (action IN (
    'dismiss', 'hide', 'unhide', 'edit', 'close', 'clear_profile', 'warn', 'suspend', 'unsuspend'
  )),
  CONSTRAINT moderation_actions_target_type_valid CHECK (
    target_type IN (
      'forum_topic', 'forum_post', 'case', 'case_comment', 'profile', 'message', 'user'
    )
  ),
  -- Ação sobre conta aponta para o usuário; as demais, para o conteúdo.
  CONSTRAINT moderation_actions_user_target_matches CHECK (
    (action IN ('warn', 'suspend', 'unsuspend')) =
      (target_type = 'user' AND target_id = target_user_id)
  ),
  -- Advertência e suspensão sempre têm motivo (026, RF-05).
  CONSTRAINT moderation_actions_reason_required CHECK (
    action NOT IN ('warn', 'suspend', 'unsuspend') OR btrim(coalesce(reason, '')) <> ''
  ),
  CONSTRAINT moderation_actions_reason_length CHECK (char_length(reason) <= 2000)
);

-- Histórico na ficha do usuário: WHERE target_user_id = $1 ORDER BY created_at DESC.
CREATE INDEX moderation_actions_target_user_idx
  ON moderation_actions (target_user_id, created_at DESC);

-- Histórico do conteúdo: WHERE target_type = $1 AND target_id = $2 ORDER BY created_at DESC.
CREATE INDEX moderation_actions_target_idx
  ON moderation_actions (target_type, target_id, created_at DESC);

-- Expurgo (2 anos): WHERE created_at < now() - interval '2 years'.
CREATE INDEX moderation_actions_created_at_idx ON moderation_actions (created_at);

-- migrate:down

ALTER TABLE lessons DROP CONSTRAINT lessons_forum_topic_id_fkey;
DROP INDEX lessons_forum_topic_unique;
DROP TABLE moderation_actions;
DROP TABLE reports;
DROP TABLE forum_topic_follows;
ALTER TABLE forum_topics DROP CONSTRAINT forum_topics_solution_post_id_fkey;
DROP TABLE forum_posts;
DROP TABLE reactions;
DROP TRIGGER forum_topics_guard_solution ON forum_topics;
DROP FUNCTION forum_posts_single_level();
DROP FUNCTION forum_topics_guard_solution();
DROP TABLE forum_topics;
DROP FUNCTION forum_reactions_cleanup();
DROP TABLE forum_categories;
