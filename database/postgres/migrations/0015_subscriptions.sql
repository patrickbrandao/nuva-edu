-- 0015: assinaturas (specs 012, "Dados"; 010, "Fontes"; 013, "Assinatura").
-- Donos dos dados: admin-api (planos e itens); classroom-api (criação e cancelamento da
-- assinatura); worker (estado, períodos e direitos).
--
-- Fecha os vínculos que a 0014 deixou abertos: a chave estrangeira de
-- payments.subscription_id e a coerência de refunds.order_id com o dono do pagamento.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 a 0014; relatadas ao
-- arquiteto na tarefa 504):
-- - plans.group_key também é slug (minúsculas, hífen): é a chave pública que agrupa as duas
--   periodicidades na vitrine (spec 012, "Planos"). Título e descrição são o texto livre.
--   UNIQUE (group_key, interval): um grupo tem no máximo um plano por periodicidade.
-- - plans.provider_plan_id fica nulo até o ensurePlan devolver o identificador (013). O índice
--   único parcial impede dois planos locais apontarem para o mesmo plano do provedor.
--   plans não guarda currency: a instalação tem uma moeda só (013, "Moeda"); a assinatura copia
--   o valor vigente.
-- - plan_items não tem id, como coupon_products; product_id é polimórfico e sem chave
--   estrangeira (courses, bundles ou ebooks), conferido pelo código. A regra "includes_all
--   falso" para ter itens e "includes_all verdadeiro" para incluir private atravessa tabelas e
--   fica no código, como a coerência de coupon_products.
-- - subscriptions.price_cents é o preço contratado, copiado do plano na criação (spec 012); o
--   plano pode mudar de preço sem tocar nas assinaturas existentes. plans.price_cents é maior
--   que zero, então a assinatura também é.
-- - subscriptions.currency copia a moeda da instalação na criação, como orders.currency.
-- - status é o ciclo de vida da spec 012. O banco garante o conjunto de valores e a coerência
--   dos campos com ele; a máquina de estados (quem pode ir para onde) é do código:
--   - current_period_start e current_period_end andam juntos, com fim posterior ao início;
--   - active, past_due e canceling exigem o período (são estados com acesso pago em curso);
--     suspended e ended mantêm o período para histórico, e pending/expired podem não ter;
--   - grace_until é obrigatório em past_due e suspended. É a referência do fim da carência
--     (worker a cada 15 min) e da suspensão de 30 dias (grace_until + 30 dias): a spec não tem
--     suspended_at;
--   - canceled_at e cancel_reason andam juntos; canceling exige os dois. cancel_reason é texto
--     de 1 a 200 caracteres porque a spec não fixa o vocabulário (ao contrário de revoke_reason);
--   - ended_at existe exatamente em ended. expired é "nunca foi paga", então não tem ended_at.
-- - provider_subscription_id é nulo enquanto o provedor não devolveu a adesão; o índice único
--   (provider, provider_subscription_id) é a idempotência da reconciliação e do webhook, como
--   payments (provider, provider_payment_id).
-- - Assinar duas vezes o mesmo plano é recusado (spec 012). O índice único parcial
--   (user_id, plan_id) vale para pending, active, past_due e suspended; canceling fica de fora
--   porque a spec manda o aluno assinar de novo para desfazer o cancelamento antes do fim do
--   período. A recusa 409 continua sendo do código; o índice protege a corrida entre checkouts.
-- - O usuário nunca é apagado (linha anonimizada, 030), como em orders e certificates: a chave
--   de user_id não tem cascata. Plano com assinaturas não pode ser excluído (spec 012): a chave
--   de plan_id recusa. coupon_id vira nulo se o cupom for apagado, como em orders.
-- - payments.subscription_id ganha a chave da 0015 com ON DELETE CASCADE, espelhando
--   payments.order_id. Toda cobrança recorrente é um pagamento, então a FK é o vínculo que
--   faltava.
-- - refunds.order_id: nulo no reembolso de cobrança recorrente e igual a payments.order_id no
--   reembolso de pedido. A coerência cruza duas tabelas e é garantida pelo gatilho
--   refunds_payment_owner (a spec 012 usa o mesmo fluxo de refunds da 011).
-- - Índices das rotinas e das telas: pending vencida (30 min), carência (15 min), suspensa
--   (30 dias), reconciliação por estado, histórico do aluno, lista do admin, vitrine e recálculo
--   de itens do plano.

-- migrate:up

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL,
  -- Agrupa as periodicidades do mesmo conteúdo na vitrine (mensal e anual).
  group_key text NOT NULL,
  title text NOT NULL,
  description text,
  interval text NOT NULL,
  -- Preço por período, maior que zero.
  price_cents bigint NOT NULL,
  -- Verdadeiro = todo produto publicado pago ou aberto, atual e futuro.
  includes_all boolean NOT NULL DEFAULT false,
  -- Só com includes_all: inclui também os produtos private.
  includes_private boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  -- Identificador do plano no provedor (ensurePlan); nulo até existir.
  provider_plan_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_slug_unique UNIQUE (slug),
  CONSTRAINT plans_group_interval_unique UNIQUE (group_key, interval),
  CONSTRAINT plans_slug_format CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 160
  ),
  CONSTRAINT plans_group_key_format CHECK (
    group_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(group_key) <= 160
  ),
  CONSTRAINT plans_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  CONSTRAINT plans_description_length CHECK (char_length(description) <= 20000),
  CONSTRAINT plans_interval_valid CHECK (interval IN ('month', 'year')),
  CONSTRAINT plans_price_positive CHECK (price_cents > 0),
  CONSTRAINT plans_includes_private_requires_all CHECK (
    NOT includes_private OR includes_all
  ),
  CONSTRAINT plans_position_range CHECK (position >= 0),
  CONSTRAINT plans_provider_plan_id_format CHECK (
    provider_plan_id IS NULL
    OR (btrim(provider_plan_id) <> '' AND char_length(provider_plan_id) <= 255)
  )
);

-- Um plano do provedor por plano local (ensurePlan).
CREATE UNIQUE INDEX plans_provider_plan_unique ON plans (provider_plan_id)
  WHERE provider_plan_id IS NOT NULL;
-- Vitrine pública: WHERE active ORDER BY position, id.
CREATE INDEX plans_active_position_idx ON plans (position, id)
  WHERE active;

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Itens liberados quando includes_all é falso (spec 012, "Planos").
CREATE TABLE plan_items (
  plan_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  CONSTRAINT plan_items_pkey PRIMARY KEY (plan_id, product_type, product_id),
  CONSTRAINT plan_items_plan_id_fkey FOREIGN KEY (plan_id)
    REFERENCES plans (id) ON DELETE CASCADE,
  CONSTRAINT plan_items_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  )
);

-- Recálculo ao publicar um produto: WHERE product_type = $1 AND product_id = $2.
CREATE INDEX plan_items_product_idx ON plan_items (product_type, product_id);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  -- Preço contratado, copiado do plano na criação.
  price_cents bigint NOT NULL,
  currency text NOT NULL,
  coupon_id uuid,
  provider text NOT NULL,
  -- Nulo enquanto o provedor não devolveu a adesão.
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  -- Fim da carência de 3 dias (past_due e suspended).
  grace_until timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id),
  -- Plano com assinaturas não é excluído, só desativado (spec 012).
  CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id)
    REFERENCES plans (id),
  CONSTRAINT subscriptions_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE SET NULL,
  CONSTRAINT subscriptions_status_valid CHECK (
    status IN ('pending', 'active', 'past_due', 'suspended', 'canceling', 'ended', 'expired')
  ),
  CONSTRAINT subscriptions_price_positive CHECK (price_cents > 0),
  CONSTRAINT subscriptions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT subscriptions_provider_valid CHECK (provider IN ('mercadopago', 'fake')),
  CONSTRAINT subscriptions_provider_subscription_id_format CHECK (
    provider_subscription_id IS NULL
    OR (btrim(provider_subscription_id) <> '' AND char_length(provider_subscription_id) <= 255)
  ),
  CONSTRAINT subscriptions_period_pair CHECK (
    (current_period_start IS NULL) = (current_period_end IS NULL)
  ),
  CONSTRAINT subscriptions_period_order CHECK (current_period_end > current_period_start),
  CONSTRAINT subscriptions_period_required CHECK (
    status NOT IN ('active', 'past_due', 'canceling')
    OR current_period_end IS NOT NULL
  ),
  CONSTRAINT subscriptions_grace_required CHECK (
    status NOT IN ('past_due', 'suspended') OR grace_until IS NOT NULL
  ),
  CONSTRAINT subscriptions_canceled_together CHECK (
    (canceled_at IS NULL) = (cancel_reason IS NULL)
  ),
  CONSTRAINT subscriptions_cancel_reason_length CHECK (
    cancel_reason IS NULL
    OR (btrim(cancel_reason) <> '' AND char_length(cancel_reason) <= 200)
  ),
  CONSTRAINT subscriptions_canceling_requires_cancel CHECK (
    status <> 'canceling' OR canceled_at IS NOT NULL
  ),
  CONSTRAINT subscriptions_ended_at_matches_status CHECK (
    (status = 'ended') = (ended_at IS NOT NULL)
  )
);

-- Idempotência da adesão e da reconciliação por provedor (como payments).
CREATE UNIQUE INDEX subscriptions_provider_subscription_unique
  ON subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
-- "Minha assinatura" e histórico do aluno: WHERE user_id = $1 ORDER BY created_at DESC, id DESC.
CREATE INDEX subscriptions_user_created_idx
  ON subscriptions (user_id, created_at DESC, id DESC);
-- Lista e filtro do admin, e varredura da reconciliação por estado.
CREATE INDEX subscriptions_status_created_idx
  ON subscriptions (status, created_at DESC, id DESC);
-- Lista sem filtro: ORDER BY created_at DESC, id DESC.
CREATE INDEX subscriptions_created_idx ON subscriptions (created_at DESC, id DESC);
-- Chave estrangeira do plano e recálculo dos direitos das assinaturas dele.
CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id);
-- Pending sem pagamento em 30 min: WHERE status = 'pending' AND created_at < now() - 30 min.
CREATE INDEX subscriptions_pending_created_idx ON subscriptions (created_at)
  WHERE status = 'pending';
-- Fim da carência, verificado a cada 15 min: WHERE status = 'past_due' AND grace_until < now().
CREATE INDEX subscriptions_grace_due_idx ON subscriptions (grace_until)
  WHERE status = 'past_due';
-- Suspensa há 30 dias: WHERE status = 'suspended' AND grace_until + 30 dias < now().
CREATE INDEX subscriptions_suspended_grace_idx ON subscriptions (grace_until)
  WHERE status = 'suspended';

-- Assinar duas vezes o mesmo plano é recusado; canceling fica de fora para o aluno assinar de
-- novo antes do fim do período já pago (spec 012, "Ciclo de vida").
CREATE UNIQUE INDEX subscriptions_user_plan_open_unique
  ON subscriptions (user_id, plan_id)
  WHERE status IN ('pending', 'active', 'past_due', 'suspended');

CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A 0014 criou payments.subscription_id sem chave; a 0015 fecha o vínculo.
ALTER TABLE payments
  ADD CONSTRAINT payments_subscription_id_fkey FOREIGN KEY (subscription_id)
    REFERENCES subscriptions (id) ON DELETE CASCADE;

-- Reembolso de cobrança recorrente não pertence a pedido; o de pedido aponta para o mesmo
-- pedido do pagamento. Cruza payments e refunds, por isso é gatilho e não CHECK.
CREATE FUNCTION refunds_payment_owner() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  payment_order_id uuid;
  payment_subscription_id uuid;
BEGIN
  SELECT order_id, subscription_id
    INTO payment_order_id, payment_subscription_id
    FROM payments
   WHERE id = NEW.payment_id;

  IF payment_subscription_id IS NOT NULL THEN
    IF NEW.order_id IS NOT NULL THEN
      RAISE EXCEPTION 'reembolso de cobrança recorrente não tem pedido'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.order_id IS DISTINCT FROM payment_order_id THEN
    RAISE EXCEPTION 'reembolso de pedido precisa apontar para o pedido do pagamento'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_payment_owner
  BEFORE INSERT OR UPDATE OF payment_id, order_id ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_payment_owner();

-- migrate:down

DROP TRIGGER refunds_payment_owner ON refunds;
DROP FUNCTION refunds_payment_owner();
ALTER TABLE payments DROP CONSTRAINT payments_subscription_id_fkey;
DROP TABLE subscriptions;
DROP TABLE plan_items;
DROP TABLE plans;
