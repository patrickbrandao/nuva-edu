-- 0014: vendas e pagamentos (specs 011, 012 e 013, "Dados").
-- Donos dos dados: classroom-api (carts, cart_items, orders e order_items na criação; e
-- webhook_events no recebimento); worker (estado de orders, payments, refunds e
-- webhook_events); admin-api (coupons e o pedido de reembolso).
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 a 0013; relatadas ao
-- arquiteto na tarefa 503):
-- - orders.number vem de order_number_seq (começa em 1). É só o número legível do pedido: a
--   sequência não volta atrás em ROLLBACK e pode ter saltos, como user_event_id_seq.
-- - orders.coupon_code guarda o código do cupom no momento do pedido. O CSV e a retenção de
--   5 anos não dependem de o cupom continuar existindo ou com o mesmo código; coupon_id
--   aponta para o cupom e vira nulo se ele for apagado (a API só desativa).
-- - buyer_tax_id copia users.tax_id sem formato no banco: o CNPJ alfanumérico convive com o
--   numérico, como decidido na 0005. Dígito verificador e "só dígitos" são regra do código.
-- - payments tem um único dono: order_id ou subscription_id (num_nonnulls = 1). A chave de
--   subscriptions entra na 0015; até lá subscription_id não tem chave estrangeira.
-- - payments.raw_status é o estado original do provedor (ProviderPayment.rawStatus), nunca o
--   corpo da resposta. O pagamento não guarda dado de cartão.
-- - refunds.payment_id é a cobrança estornada; toda cobrança de assinatura também é um
--   payment. order_id fica nulo no reembolso de cobrança recorrente (0015 completa o
--   vínculo). items é um array JSON de { orderItemId, amountCents }, validado pelo código; a
--   cobrança recorrente usa [].
-- - refunds.status usa requested | done | failed (spec 011); a resposta pending | approved |
--   rejected do provedor é traduzida pelo worker. A reconciliação procura requested há mais
--   de 5 min por updated_at.
-- - webhook_events não guarda corpo, cabeçalhos nem assinatura. A chave única é parcial:
--   (provider, event_id) só para event_id não nulo e status diferente de rejected. Uma
--   rejeição não ocupa a chave, e várias podem guardar o mesmo identificador ainda não
--   autenticado; o evento válido posterior é gravado e processado normalmente.
-- - carts.updated_at muda pela cesta e por item que entra ou sai (gatilho), para a retenção
--   de 30 dias (NUVA_RETENTION_CART_DAYS) não apagar cesta em uso.
-- - Limites de 50 itens por cesta, 3 pedidos pending por aluno, 8 tentativas do webhook e 90
--   dias da trilha de rejeição são do código; o banco garante as invariantes de estado e de
--   valores, e os índices das consultas de reconciliação, expurgo e CSV.
-- - Pedido sem nota fiscal (fora de escopo da 011): não há campos de emissão fiscal, só os
--   dados do comprador copiados para o pedido.

-- migrate:up

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Comparação sem diferenciar maiúsculas: o índice único é sobre lower(code).
  code text NOT NULL,
  kind text NOT NULL,
  -- percent: 1 a 100. fixed: valor em centavos.
  percent_off integer,
  amount_off_cents bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Nulo = ilimitado.
  max_uses integer,
  max_uses_per_user integer NOT NULL DEFAULT 1,
  -- Pode passar de max_uses: pedido pago com o limite estourado é honrado e o excesso fica
  -- registrado (spec 011).
  uses_count integer NOT NULL DEFAULT 0,
  applies_to text NOT NULL DEFAULT 'orders',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_format CHECK (code ~ '^[A-Za-z0-9-]{3,40}$'),
  CONSTRAINT coupons_kind_valid CHECK (kind IN ('percent', 'fixed')),
  CONSTRAINT coupons_discount_matches_kind CHECK (
    CASE kind
      WHEN 'percent' THEN percent_off BETWEEN 1 AND 100 AND amount_off_cents IS NULL
      WHEN 'fixed' THEN amount_off_cents > 0 AND percent_off IS NULL
    END
  ),
  CONSTRAINT coupons_window_valid CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  ),
  CONSTRAINT coupons_max_uses_range CHECK (max_uses IS NULL OR max_uses >= 1),
  CONSTRAINT coupons_max_uses_per_user_range CHECK (max_uses_per_user >= 1),
  CONSTRAINT coupons_uses_count_range CHECK (uses_count >= 0),
  CONSTRAINT coupons_applies_to_valid CHECK (applies_to IN ('orders', 'subscriptions', 'both')),
  CONSTRAINT coupons_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id)
);

-- Código único sem diferenciar maiúsculas (spec 011).
CREATE UNIQUE INDEX coupons_code_unique ON coupons (lower(code));

CREATE TRIGGER coupons_set_updated_at BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Restrição opcional de produtos: vazia = vale para todos (spec 011).
CREATE TABLE coupon_products (
  coupon_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  CONSTRAINT coupon_products_pkey PRIMARY KEY (coupon_id, product_type, product_id),
  CONSTRAINT coupon_products_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE CASCADE,
  CONSTRAINT coupon_products_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  )
);

-- Elegibilidade por produto e vínculos do produto: WHERE product_type = $1 AND product_id = $2.
CREATE INDEX coupon_products_product_idx ON coupon_products (product_type, product_id);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Uma cesta aberta por usuário (spec 011).
  user_id uuid NOT NULL,
  coupon_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_user_id_unique UNIQUE (user_id),
  CONSTRAINT carts_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT carts_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE SET NULL
);

-- Retenção de 30 dias (spec 011): WHERE updated_at < now() - interval '30 days'.
CREATE INDEX carts_updated_idx ON carts (updated_at);

CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  cart_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_cart_product_unique UNIQUE (cart_id, product_type, product_id),
  CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id)
    REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT cart_items_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  )
);

-- A retenção conta a última alteração da cesta, inclusive quando só um item mudou.
CREATE FUNCTION cart_items_touch_cart() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.cart_id IS DISTINCT FROM NEW.cart_id) THEN
    UPDATE carts SET updated_at = now() WHERE id = OLD.cart_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    UPDATE carts SET updated_at = now() WHERE id = NEW.cart_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER cart_items_touch_cart
  AFTER INSERT OR UPDATE OR DELETE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION cart_items_touch_cart();

-- Número legível do pedido; saltos são aceitos (ROLLBACK não devolve o número).
CREATE SEQUENCE order_number_seq AS bigint;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  number bigint NOT NULL DEFAULT nextval('order_number_seq'),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  subtotal_cents bigint NOT NULL,
  discount_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL,
  currency text NOT NULL,
  coupon_id uuid,
  -- Código congelado no pedido (CSV e retenção de 5 anos).
  coupon_code text,
  -- Dados do comprador copiados no fechamento (spec 011, "Dados do comprador").
  buyer_name text NOT NULL,
  buyer_tax_id_type text NOT NULL,
  buyer_tax_id text NOT NULL,
  -- 'none' no pedido de total zero, que não passa pelo provedor.
  provider text NOT NULL DEFAULT 'none',
  -- Prazo do pending: 30 min (cartão e Pix) ou 3 dias (boleto).
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_number_unique UNIQUE (number),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT orders_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE SET NULL,
  CONSTRAINT orders_status_valid CHECK (
    status IN (
      'draft', 'pending', 'paid', 'partially_refunded', 'refunded', 'canceled', 'expired',
      'chargeback'
    )
  ),
  CONSTRAINT orders_number_positive CHECK (number > 0),
  CONSTRAINT orders_subtotal_range CHECK (subtotal_cents >= 0),
  CONSTRAINT orders_discount_range CHECK (
    discount_cents >= 0 AND discount_cents <= subtotal_cents
  ),
  CONSTRAINT orders_total_matches CHECK (total_cents = subtotal_cents - discount_cents),
  CONSTRAINT orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT orders_coupon_code_format CHECK (
    coupon_code IS NULL OR coupon_code ~ '^[A-Za-z0-9-]{3,40}$'
  ),
  CONSTRAINT orders_coupon_code_matches CHECK (coupon_id IS NULL OR coupon_code IS NOT NULL),
  CONSTRAINT orders_buyer_name_length CHECK (
    btrim(buyer_name) <> '' AND char_length(buyer_name) <= 200
  ),
  CONSTRAINT orders_buyer_tax_id_type_valid CHECK (buyer_tax_id_type IN ('cpf', 'cnpj')),
  CONSTRAINT orders_buyer_tax_id_format CHECK (
    btrim(buyer_tax_id) <> '' AND char_length(buyer_tax_id) <= 32
  ),
  CONSTRAINT orders_provider_valid CHECK (provider IN ('mercadopago', 'fake', 'none')),
  CONSTRAINT orders_free_order_without_provider CHECK (total_cents <> 0 OR provider = 'none'),
  CONSTRAINT orders_pending_has_expiry CHECK (status <> 'pending' OR expires_at IS NOT NULL),
  CONSTRAINT orders_paid_at_matches_status CHECK (
    (status IN ('paid', 'partially_refunded', 'refunded', 'chargeback')) = (paid_at IS NOT NULL)
  )
);

-- "Meus pedidos" do aluno e filtro por comprador no admin: WHERE user_id = $1
-- ORDER BY created_at DESC, id DESC.
CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC, id DESC);
-- Lista do admin por estado e reconciliação de pending: WHERE status = $1
-- ORDER BY created_at DESC, id DESC.
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC, id DESC);
-- Lista e CSV por período sem filtro: ORDER BY created_at DESC, id DESC.
CREATE INDEX orders_created_idx ON orders (created_at DESC, id DESC);
-- Filtro por cupom e chave estrangeira: WHERE coupon_id = $1.
CREATE INDEX orders_coupon_idx ON orders (coupon_id) WHERE coupon_id IS NOT NULL;
-- Vencimento do pending: WHERE status = 'pending' AND expires_at < now().
CREATE INDEX orders_expires_idx ON orders (expires_at) WHERE status = 'pending';
-- Limite de 3 pedidos pending por aluno: WHERE user_id = $1 AND status = 'pending'.
CREATE INDEX orders_user_pending_idx ON orders (user_id) WHERE status = 'pending';
-- Filtro por comprador na lista e no CSV: buyer_name ILIKE '%termo%'.
CREATE INDEX orders_buyer_name_trgm_idx ON orders USING gin (buyer_name gin_trgm_ops);

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id uuid NOT NULL,
  product_type text NOT NULL,
  -- courses.id, bundles.id ou ebooks.id, conforme product_type; sem chave estrangeira.
  product_id uuid NOT NULL,
  -- Preços e títulos congelados no fechamento (spec 011, RF-02).
  title_snapshot text NOT NULL,
  -- Nulo = vitalício.
  access_days_snapshot integer,
  unit_price_cents bigint NOT NULL,
  discount_cents bigint NOT NULL DEFAULT 0,
  paid_cents bigint NOT NULL,
  refunded_cents bigint NOT NULL DEFAULT 0,
  CONSTRAINT order_items_order_product_unique UNIQUE (order_id, product_type, product_id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_type_valid CHECK (
    product_type IN ('course', 'bundle', 'ebook')
  ),
  CONSTRAINT order_items_title_snapshot_length CHECK (
    btrim(title_snapshot) <> '' AND char_length(title_snapshot) <= 160
  ),
  CONSTRAINT order_items_access_days_range CHECK (
    access_days_snapshot IS NULL OR access_days_snapshot >= 1
  ),
  CONSTRAINT order_items_unit_price_range CHECK (unit_price_cents >= 0),
  CONSTRAINT order_items_discount_range CHECK (
    discount_cents >= 0 AND discount_cents <= unit_price_cents
  ),
  -- Valor pago pelo item: preço menos o desconto rateado.
  CONSTRAINT order_items_paid_matches CHECK (paid_cents = unit_price_cents - discount_cents),
  CONSTRAINT order_items_refunded_range CHECK (
    refunded_cents >= 0 AND refunded_cents <= paid_cents
  )
);

-- Filtro por produto no admin e créditos da cascata: WHERE product_type = $1
-- AND product_id = ANY($2); a chave do pedido já atende order_id.
CREATE INDEX order_items_product_idx ON order_items (product_type, product_id, order_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id uuid,
  -- subscriptions.id a partir da 0015; sem chave estrangeira nesta migration.
  subscription_id uuid,
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  status text NOT NULL,
  method text NOT NULL,
  amount_cents bigint NOT NULL,
  refunded_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL,
  -- Estado original, para diagnóstico; nunca o corpo da resposta.
  raw_status text NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT payments_owner_exactly_one CHECK (num_nonnulls(order_id, subscription_id) = 1),
  CONSTRAINT payments_provider_valid CHECK (provider IN ('mercadopago', 'fake')),
  CONSTRAINT payments_provider_payment_id_format CHECK (
    btrim(provider_payment_id) <> '' AND char_length(provider_payment_id) <= 255
  ),
  CONSTRAINT payments_status_valid CHECK (
    status IN (
      'pending', 'approved', 'rejected', 'canceled', 'refunded', 'partially_refunded',
      'charged_back'
    )
  ),
  CONSTRAINT payments_method_valid CHECK (method IN ('card', 'pix', 'boleto', 'other')),
  CONSTRAINT payments_amount_range CHECK (amount_cents >= 0),
  CONSTRAINT payments_refunded_range CHECK (
    refunded_cents >= 0 AND refunded_cents <= amount_cents
  ),
  -- Estados normalizados (spec 013): refunded é o total e partially_refunded, o parcial;
  -- pending, rejected e canceled não têm valor reembolsado.
  CONSTRAINT payments_refunded_matches_status CHECK (
    (status <> 'refunded' OR refunded_cents = amount_cents)
    AND (
      status <> 'partially_refunded'
      OR (refunded_cents > 0 AND refunded_cents < amount_cents)
    )
    AND (status NOT IN ('pending', 'rejected', 'canceled') OR refunded_cents = 0)
  ),
  CONSTRAINT payments_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payments_raw_status_format CHECK (
    btrim(raw_status) <> '' AND char_length(raw_status) <= 100
  ),
  CONSTRAINT payments_paid_at_matches_status CHECK (
    (status IN ('approved', 'refunded', 'partially_refunded', 'charged_back'))
      = (paid_at IS NOT NULL)
  )
);

-- Idempotência do webhook e da reconciliação: um pagamento por provedor e identificador.
CREATE UNIQUE INDEX payments_provider_payment_unique
  ON payments (provider, provider_payment_id);
-- Pagamentos do pedido, do mais recente ao mais antigo (tentativas) e chave estrangeira.
CREATE INDEX payments_order_idx ON payments (order_id, created_at DESC)
  WHERE order_id IS NOT NULL;
-- Cobranças da assinatura (0015) e chave estrangeira futura.
CREATE INDEX payments_subscription_idx ON payments (subscription_id, created_at DESC)
  WHERE subscription_id IS NOT NULL;

CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Nulo no reembolso de cobrança recorrente (0015 completa o vínculo).
  order_id uuid,
  -- Cobrança estornada no provedor.
  payment_id uuid NOT NULL,
  -- Itens e valores do pedido: [{ orderItemId, amountCents }]; [] na cobrança recorrente.
  items jsonb NOT NULL DEFAULT '[]',
  amount_cents bigint NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  provider_refund_id text,
  error text,
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  CONSTRAINT refunds_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id)
    REFERENCES payments (id) ON DELETE CASCADE,
  CONSTRAINT refunds_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT refunds_status_valid CHECK (status IN ('requested', 'done', 'failed')),
  CONSTRAINT refunds_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT refunds_reason_length CHECK (
    btrim(reason) <> '' AND char_length(reason) <= 500
  ),
  CONSTRAINT refunds_items_array CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT refunds_provider_refund_id_format CHECK (
    provider_refund_id IS NULL
    OR (btrim(provider_refund_id) <> '' AND char_length(provider_refund_id) <= 255)
  ),
  CONSTRAINT refunds_error_length CHECK (
    error IS NULL OR (btrim(error) <> '' AND char_length(error) <= 2000)
  ),
  CONSTRAINT refunds_done_at_matches_status CHECK ((status = 'done') = (done_at IS NOT NULL)),
  CONSTRAINT refunds_error_matches_status CHECK ((status = 'failed') = (error IS NOT NULL))
);

-- Chave estrangeira da cobrança e histórico da cobrança.
CREATE INDEX refunds_payment_idx ON refunds (payment_id);
-- Reembolsos do pedido na tela do admin: WHERE order_id = $1.
CREATE INDEX refunds_order_idx ON refunds (order_id) WHERE order_id IS NOT NULL;
-- Reconciliação: WHERE status = 'requested' AND updated_at < now() - interval '5 minutes'.
CREATE INDEX refunds_requested_updated_idx ON refunds (updated_at) WHERE status = 'requested';

CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  provider text NOT NULL,
  -- Nulo quando o identificador do evento não foi extraído.
  event_id text,
  resource_type text,
  -- Nulo quando o identificador do recurso não foi extraído.
  resource_id text,
  status text NOT NULL DEFAULT 'received',
  attempts integer NOT NULL DEFAULT 0,
  -- 'invalid_signature' na rejeição; motivo da falha definitiva em failed.
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT webhook_events_provider_valid CHECK (provider IN ('mercadopago', 'fake')),
  CONSTRAINT webhook_events_event_id_format CHECK (
    event_id IS NULL OR (btrim(event_id) <> '' AND char_length(event_id) <= 255)
  ),
  CONSTRAINT webhook_events_resource_type_valid CHECK (
    resource_type IN ('payment', 'subscription')
  ),
  CONSTRAINT webhook_events_resource_id_format CHECK (
    resource_id IS NULL OR (btrim(resource_id) <> '' AND char_length(resource_id) <= 255)
  ),
  CONSTRAINT webhook_events_status_valid CHECK (
    status IN ('received', 'rejected', 'processed', 'ignored', 'failed')
  ),
  CONSTRAINT webhook_events_attempts_range CHECK (attempts >= 0),
  CONSTRAINT webhook_events_error_length CHECK (
    error IS NULL OR (btrim(error) <> '' AND char_length(error) <= 2000)
  ),
  CONSTRAINT webhook_events_processed_at_matches_status CHECK (
    (status IN ('processed', 'ignored')) = (processed_at IS NOT NULL)
  ),
  CONSTRAINT webhook_events_error_matches_status CHECK (
    (status IN ('rejected', 'failed')) = (error IS NOT NULL)
  ),
  CONSTRAINT webhook_events_rejected_reason CHECK (
    status <> 'rejected' OR error = 'invalid_signature'
  ),
  -- Rejeição é só trilha de segurança: não é tentativa de processamento.
  CONSTRAINT webhook_events_rejection_without_processing CHECK (
    status <> 'rejected' OR attempts = 0
  )
);

-- Idempotência do evento válido. Rejeições não ocupam a chave: várias podem guardar o mesmo
-- identificador ainda não autenticado, e o evento válido posterior entra normalmente.
CREATE UNIQUE INDEX webhook_events_event_unique ON webhook_events (provider, event_id)
  WHERE event_id IS NOT NULL AND status <> 'rejected';
-- Lista de falhas do admin e retenção de 90 dias (spec 013 e 033).
CREATE INDEX webhook_events_status_received_idx
  ON webhook_events (status, received_at DESC, id DESC);
CREATE INDEX webhook_events_received_idx ON webhook_events (received_at);

-- Rejeição é só trilha de segurança: não aceita reprocessamento (spec 013). O expurgo de
-- 90 dias continua apagando a linha; o que não passa é alterar o estado.
CREATE FUNCTION webhook_events_guard_rejected() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'rejected' THEN
    RAISE EXCEPTION 'webhook_events rejected não aceita reprocessamento'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_events_guard_rejected
  BEFORE UPDATE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION webhook_events_guard_rejected();

-- migrate:down

DROP TABLE webhook_events;
DROP FUNCTION webhook_events_guard_rejected();
DROP TABLE refunds;
DROP TABLE payments;
DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE cart_items;
DROP FUNCTION cart_items_touch_cart();
DROP TABLE carts;
DROP TABLE coupon_products;
DROP TABLE coupons;
DROP SEQUENCE order_number_seq;
