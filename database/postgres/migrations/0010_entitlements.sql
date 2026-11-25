-- 0010: direitos de acesso (spec 010, "Dados").
-- Donos dos dados: worker (raízes order e subscription e recálculo), admin-api (raiz grant);
-- os derivados cascade são gravados por quem grava a raiz, na mesma transação.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009; relatadas ao arquiteto
-- na tarefa 406):
-- - version (começa em 1, incrementada pelo código), created_at e updated_at (gatilho
--   set_updated_at): revogação, renovação e extensão alteram a linha.
-- - product_id e source_id são polimórficos e sem chave estrangeira: a existência do produto
--   (courses, bundles, ebooks) e da fonte (order_items, subscriptions, users) é conferida pelo
--   código. Só user_id e parent_entitlement_id têm chave.
-- - user_id com ON DELETE CASCADE: os direitos só existem por causa da conta e são apagados na
--   exclusão (spec 010, "Retenção"). parent_entitlement_id também em cascata: a árvore pertence
--   à raiz (o código nunca apaga direito avulso; revoga).
-- - A chave do pai é composta (parent_entitlement_id, user_id, source_id): o derivado tem o
--   mesmo dono e o mesmo source_id do pai (spec 010, "Fontes" e passo 3 da concessão).
-- - cascade tem pai e raiz não tem; derivado nunca é bundle (pacote não contém pacote, e curso
--   só libera ebooks). A profundidade (até 2) é regra do código.
-- - granted_reason obrigatório em grant (RF-06), 1 a 500 caracteres, e nulo nas demais fontes.
-- - revoked_at e revoke_reason andam juntos; expires_at, quando há, é posterior a starts_at;
--   starts_at tem padrão now().
-- - O único da idempotência é parcial em revoked_at IS NULL: depois de revogado, o mesmo
--   direito pode ser concedido de novo (concessão manual repetida pelo mesmo admin; item
--   removido e reincluído num pacote no recálculo). Impedir a reconcessão de um pedido já
--   reembolsado (webhook reprocessado) é regra do código, que confere o estado do pedido.
--   parent_entitlement_id entra como valor (NULLS NOT DISTINCT): duas raízes iguais colidem.

-- migrate:up

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  source text NOT NULL,
  -- order_items.id, subscriptions.id ou users.id de quem concedeu; em cascade, o do pai.
  source_id uuid NOT NULL,
  -- Nulo nas raízes (order, subscription, grant).
  parent_entitlement_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  -- Nulo = vitalício.
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  -- Motivo da concessão manual; só em grant.
  granted_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Alvo da chave composta do pai.
  CONSTRAINT entitlements_id_user_source_unique UNIQUE (id, user_id, source_id),
  CONSTRAINT entitlements_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT entitlements_parent_entitlement_id_fkey
    FOREIGN KEY (parent_entitlement_id, user_id, source_id)
    REFERENCES entitlements (id, user_id, source_id) ON DELETE CASCADE,
  CONSTRAINT entitlements_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  ),
  CONSTRAINT entitlements_source_valid CHECK (
    source IN ('order', 'subscription', 'grant', 'cascade')
  ),
  CONSTRAINT entitlements_parent_matches_source CHECK (
    (source = 'cascade') = (parent_entitlement_id IS NOT NULL)
  ),
  CONSTRAINT entitlements_cascade_product_type CHECK (
    source <> 'cascade' OR product_type <> 'bundle'
  ),
  CONSTRAINT entitlements_not_own_parent CHECK (parent_entitlement_id <> id),
  CONSTRAINT entitlements_expires_after_starts CHECK (expires_at > starts_at),
  CONSTRAINT entitlements_revoke_reason_valid CHECK (
    revoke_reason IN (
      'refund', 'chargeback', 'subscription_ended', 'manual', 'recalculation', 'account_deleted'
    )
  ),
  CONSTRAINT entitlements_revoked_together CHECK (
    (revoked_at IS NULL) = (revoke_reason IS NULL)
  ),
  CONSTRAINT entitlements_granted_reason_matches_source CHECK (
    (source = 'grant') = (granted_reason IS NOT NULL)
  ),
  CONSTRAINT entitlements_granted_reason_length CHECK (
    btrim(granted_reason) <> '' AND char_length(granted_reason) <= 500
  ),
  CONSTRAINT entitlements_version_positive CHECK (version >= 1)
);

-- Verificação de acesso (canAccess, hasActiveAccess, estante) e chave estrangeira de user_id:
-- WHERE user_id = $1 AND product_type = $2 AND product_id = ANY($3).
CREATE INDEX entitlements_user_product_idx ON entitlements (user_id, product_type, product_id);
-- Revogação da árvore (descendentes, recursivo) e chave composta do pai.
CREATE INDEX entitlements_parent_idx ON entitlements (parent_entitlement_id)
  WHERE parent_entitlement_id IS NOT NULL;
-- Reembolso e ciclo da assinatura: WHERE source = $1 AND source_id = $2.
CREATE INDEX entitlements_source_idx ON entitlements (source, source_id);
-- Idempotência da concessão (spec 010): a mesma raiz, ou o mesmo derivado sob o mesmo pai,
-- só existe uma vez enquanto não revogado.
CREATE UNIQUE INDEX entitlements_idempotency_unique ON entitlements
  (user_id, source, source_id, product_type, product_id, parent_entitlement_id)
  NULLS NOT DISTINCT
  WHERE revoked_at IS NULL;

CREATE TRIGGER entitlements_set_updated_at BEFORE UPDATE ON entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE entitlements;
