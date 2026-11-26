-- 0016: central de notificações (specs 024, "Dados" e "Comportamento"; 030, "O que acontece
-- com cada dado"; 033, "Retenção").
-- Donos dos dados: notifications, o worker (criação e publicação do SSE) e as APIs (leitura,
-- marcar lida, limpar); notification_prefs, a classroom-api (aluno) e a admin-api (equipe);
-- notification_unsubscribe_tokens, o worker (gera o link) e a classroom-api (consome).
-- Reutiliza email_outbox (0007), jobs (0002) e a sequência dos eventos de usuário
-- (user_event_id_seq, 0003): esta migration não cria infraestrutura de e-mail nem de SSE.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0007 a 0015; relatadas ao
-- arquiteto na tarefa 570):
-- - notifications.group_key é coluna gerada de type e alvo (target_type/target_id): o
--   agrupamento "mesmo tipo e alvo" (spec 024, "Central") não depende de a aplicação acertar a
--   chave. O índice único parcial (user_id, group_key) WHERE read_at IS NULL torna a fusão um
--   upsert: notificação do mesmo tipo e alvo ainda não lida vira count + 1 na mesma linha;
--   depois de lida, a próxima cria linha nova (o histórico lido é preservado). Sem alvo, o
--   agrupamento é só pelo tipo.
-- - A fusão atualiza actor_id, data e created_at: a central ordena pelo fato mais recente e
--   mostra a foto e o texto de quem gerou por último ("Ana e mais 3 responderam em...").
-- - target_type/target_id são polimórficos e sem chave estrangeira (tópico, curso, chamado,
--   novidade...), conferidos pelo código como plan_items.product_id; existem juntos. O alvo é
--   uuid porque todo recurso apontado tem uuid.
-- - data é objeto JSON com os dados do modelo do tipo: nunca senha, token em claro nem motivo
--   interno de suspensão (spec 024).
-- - Chaves para users sem cascata: a linha de users nunca é apagada (spec 030) e a exclusão de
--   conta apaga notificações, preferências e tokens explicitamente, como email_outbox. actor_id
--   é referência de terceiro e fica (vira "usuário removido" na leitura).
-- - notification_prefs não tem valor padrão nos canais: o padrão de cada grupo (spec 024,
--   "Tipos e grupos") fica no código e só é gravado quando o usuário muda algo. O banco garante
--   o que não pode ser desligado: e-mail dos grupos obrigatórios (account, purchase, support e
--   moderation) e ausência do canal "plataforma" em account.
-- - O token de descadastro é único por usuário e grupo e não expira (spec 024, "Links com
--   token"): fica em claro na tabela, ao contrário do hash de email_tokens, porque o mesmo link
--   precisa valer em todo e-mail seguinte e não pode ser recuperado de um hash. Só os grupos
--   desligáveis recebem token; os obrigatórios nem chegam a gerar link.
-- - Expurgo (RNF-04, variáveis NUVA_RETENTION_NOTIFICATION_DAYS e
--   NUVA_RETENTION_NOTIFICATION_UNREAD_DAYS): lidas por read_at, não lidas por created_at, com
--   índices parciais próprios. A fusão reescreve created_at, então o prazo da não lida conta da
--   última.

-- migrate:up

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  -- Tipo do catálogo da spec 024 ('forum.reply', 'order.approved', ...).
  type text NOT NULL,
  -- Quem gerou a notificação; nulo em aviso do sistema.
  actor_id uuid,
  -- Alvo do link, polimórfico e sem chave estrangeira (conferido pelo código).
  target_type text,
  target_id uuid,
  -- Dados do modelo do tipo. Nunca senha, token em claro nem motivo interno de suspensão.
  data jsonb NOT NULL DEFAULT '{}',
  -- Chave do agrupamento de "mesmo tipo e alvo" (spec 024, "Central"). Gerada para que a fusão
  -- não dependa da aplicação.
  group_key text NOT NULL GENERATED ALWAYS AS (
    type || coalesce(':' || target_type, '') || coalesce(':' || target_id::text, '')
  ) STORED,
  -- Quantas notificações foram fundidas nesta linha.
  count integer NOT NULL DEFAULT 1,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users (id),
  CONSTRAINT notifications_type_format CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT notifications_target_pair CHECK (
    (target_type IS NULL) = (target_id IS NULL)
  ),
  CONSTRAINT notifications_target_type_format CHECK (
    target_type IS NULL OR (target_type ~ '^[a-z][a-z0-9_]*$' AND char_length(target_type) <= 40)
  ),
  CONSTRAINT notifications_data_object CHECK (jsonb_typeof(data) = 'object'),
  CONSTRAINT notifications_count_range CHECK (count >= 1),
  CONSTRAINT notifications_read_after_created CHECK (read_at >= created_at)
);

-- Fusão do ainda não lido: INSERT ... ON CONFLICT (user_id, group_key) WHERE read_at IS NULL
-- DO UPDATE SET count = notifications.count + 1, actor_id = excluded.actor_id,
--               data = excluded.data, created_at = now().
CREATE UNIQUE INDEX notifications_user_group_unread_unique
  ON notifications (user_id, group_key) WHERE read_at IS NULL;

-- Central paginada (mais recente primeiro, desempate por id):
-- WHERE user_id = $1 ORDER BY created_at DESC, id DESC.
CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC, id DESC);

-- Contador do sino, "marcar todas como lidas" e as não lidas do usuário:
-- WHERE user_id = $1 AND read_at IS NULL.
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Expurgo das lidas (90 dias): WHERE read_at < now() - interval '90 days'.
CREATE INDEX notifications_read_retention_idx
  ON notifications (read_at) WHERE read_at IS NOT NULL;

-- Expurgo das não lidas (180 dias): WHERE read_at IS NULL AND created_at < now() - interval '180 days'.
CREATE INDEX notifications_unread_retention_idx
  ON notifications (created_at) WHERE read_at IS NULL;

-- Preferências por grupo (spec 024, "Tipos e grupos"). Ausência de linha = padrão do código.
CREATE TABLE notification_prefs (
  user_id uuid NOT NULL,
  -- Grupo da preferência: 'account', 'purchase', 'courses', 'forum', 'messages', 'community',
  -- 'events', 'support', 'announcements', 'moderation' ou 'staff'. Palavra reservada: entre
  -- aspas em todo SQL.
  "group" text NOT NULL,
  -- Canal "plataforma" (central e sino).
  in_app boolean NOT NULL,
  -- Canal "e-mail".
  email boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_id, "group"),
  CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT notification_prefs_group_valid CHECK ("group" IN (
    'account', 'purchase', 'courses', 'forum', 'messages', 'community', 'events', 'support',
    'announcements', 'moderation', 'staff'
  )),
  -- RF-04: e-mail dos grupos obrigatórios não pode ser desligado (conta, compra, suporte e
  -- moderação).
  CONSTRAINT notification_prefs_email_required CHECK (
    email OR "group" NOT IN ('account', 'purchase', 'support', 'moderation')
  ),
  -- O grupo account não tem canal "plataforma" (spec 024): só e-mail.
  CONSTRAINT notification_prefs_account_has_no_in_app CHECK ("group" <> 'account' OR NOT in_app)
);

CREATE TRIGGER notification_prefs_set_updated_at BEFORE UPDATE ON notification_prefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Token do link de descadastro de um clique (spec 024, "Links com token"), sem login.
CREATE TABLE notification_unsubscribe_tokens (
  -- 32 bytes aleatórios em hexadecimal minúsculo. Em claro: o mesmo link vale em todos os
  -- e-mails seguintes do grupo (acima, no cabeçalho, está o porquê).
  token text PRIMARY KEY,
  user_id uuid NOT NULL,
  "group" text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_unsubscribe_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id),
  -- Um token por usuário e grupo: o worker o reusa (insert ... on conflict do nothing + select).
  CONSTRAINT notification_unsubscribe_tokens_user_group_unique UNIQUE (user_id, "group"),
  CONSTRAINT notification_unsubscribe_tokens_token_format CHECK (token ~ '^[0-9a-f]{64}$'),
  -- Só os grupos desligáveis têm descadastro; os obrigatórios nunca geram link.
  CONSTRAINT notification_unsubscribe_tokens_group_valid CHECK ("group" IN (
    'courses', 'forum', 'messages', 'community', 'events', 'announcements', 'staff'
  ))
);

-- migrate:down

DROP TABLE notification_unsubscribe_tokens;
DROP TRIGGER notification_prefs_set_updated_at ON notification_prefs;
DROP TABLE notification_prefs;
DROP TABLE notifications;
