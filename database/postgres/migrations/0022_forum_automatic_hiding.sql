-- migrate:up
-- A ocultação automática da spec 026 grava a data com moderador nulo.
ALTER TABLE forum_topics DROP CONSTRAINT forum_topics_hidden_matches_by,
  ADD CONSTRAINT forum_topics_hidden_matches_by CHECK (hidden_at IS NOT NULL OR hidden_by IS NULL);
ALTER TABLE forum_posts DROP CONSTRAINT forum_posts_hidden_matches_by,
  ADD CONSTRAINT forum_posts_hidden_matches_by CHECK (hidden_at IS NOT NULL OR hidden_by IS NULL);

-- migrate:down
-- Reverter exige que a equipe já tenha analisado as ocultações sem moderador.
ALTER TABLE forum_posts DROP CONSTRAINT forum_posts_hidden_matches_by,
  ADD CONSTRAINT forum_posts_hidden_matches_by CHECK ((hidden_at IS NULL) = (hidden_by IS NULL));
ALTER TABLE forum_topics DROP CONSTRAINT forum_topics_hidden_matches_by,
  ADD CONSTRAINT forum_topics_hidden_matches_by CHECK ((hidden_at IS NULL) = (hidden_by IS NULL));
