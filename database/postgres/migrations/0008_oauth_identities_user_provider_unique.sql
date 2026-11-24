-- 0008: uma identidade por provedor em cada conta (spec 007, "Login social e vínculo", "Dados").
-- Dono dos dados: a classroom-api (vínculo e remoção de identidades).
--
-- Decisões de esquema:
-- - O índice único (user_id, provider) sustenta o 409 provider_already_linked: a remoção é por
--   provedor (DELETE /account/identities/{provider}) e duas linhas do mesmo provedor na mesma
--   conta a deixariam ambígua.
-- - oauth_identities_user_idx (user_id) fica redundante: o índice novo começa por user_id e
--   atende o WHERE user_id = $1 dos métodos de acesso e a cascata da exclusão de users.
--   É removido aqui e recriado no down.
-- - Se já houver duas identidades do mesmo provedor numa conta, o CREATE UNIQUE INDEX falha
--   (23505) e a migration não é aplicada: os dados precisam ser corrigidos antes.

-- migrate:up

-- Uma identidade de cada provedor por conta (provider_already_linked).
CREATE UNIQUE INDEX oauth_identities_user_provider_unique
  ON oauth_identities (user_id, provider);

DROP INDEX oauth_identities_user_idx;

-- migrate:down

-- Métodos de acesso da conta: WHERE user_id = $1.
CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);

DROP INDEX oauth_identities_user_provider_unique;
