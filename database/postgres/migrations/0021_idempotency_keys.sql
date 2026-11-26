-- 0021: chaves de idempotência das operações financeiras (spec 003, "Convenções da API";
-- tarefa 710).
-- `POST /orders` e os dois reembolsos aceitam `Idempotency-Key` e a repetição devolve a
-- primeira resposta por 24 h, mas não havia onde guardá-la: repetir o pedido de reembolso podia
-- estornar duas vezes.
--
-- Decisões de esquema que a spec não fixa:
-- - (scope, user_id, key) é a chave primária, sem `id` próprio. A linha é identificada pelo
--   pedido que a criou e é assim que o código a lê e a reserva (INSERT ... ON CONFLICT
--   (scope, user_id, key)); um id à parte só acrescentaria um segundo índice sobre as mesmas
--   colunas, sem atender a nenhuma leitura.
-- - `user_id` tem índice próprio. O único composto começa por `scope` e não atende a cascata do
--   usuário (spec 030, exclusão de conta): sem ele, apagar uma conta varre a tabela inteira.
-- - `key` vem do cliente pelo cabeçalho HTTP; o CHECK de 1 a 200 caracteres evita que uma chave
--   enorme infle a tabela ou estoure o limite do índice btree (erro 54000, em vez de uma
--   resposta 400 tratada pelo código). `scope` é convenção do código (`order.create`,
--   `refund.order`, `refund.subscription`); o CHECK de formato e de 100 caracteres impede que
--   escopo acidental com espaço ou maiúscula divida a idempotência em dois.
-- - `response_status` nulo é a reserva em andamento. Quando preenchido, é status HTTP (100 a
--   599) e o corpo vai em `response_body` jsonb, como veio. O banco não amarra
--   `response_status` a `completed_at`: liberar uma reserva abandonada sem resposta é do
--   código, e a tarefa que implementa decide como.
-- - A retenção de 24 h apaga por `created_at` (índice próprio). `completed_at` não entra no
--   expurgo justamente para que a reserva que nunca terminou também saia.
-- - Sem reescrita de dado: as migrations 0014 a 0020 não têm a tabela, então `up` e `down`
--   mexem só no catálogo desta migration.

-- migrate:up

CREATE TABLE idempotency_keys (
  -- Chave enviada pelo cliente em `Idempotency-Key`.
  key text NOT NULL,
  -- Operação a que a chave pertence: order.create, refund.order, refund.subscription.
  scope text NOT NULL,
  user_id uuid NOT NULL,
  -- Impressão digital da requisição: a repetição igual devolve a primeira resposta; corpo
  -- diferente com a mesma chave é conflito (regra do código).
  request_hash text NOT NULL,
  -- Nulos enquanto a operação não terminou.
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (scope, user_id, key),
  CONSTRAINT idempotency_keys_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT idempotency_keys_key_length CHECK (char_length(key) BETWEEN 1 AND 200),
  CONSTRAINT idempotency_keys_scope_format CHECK (
    scope ~ '^[a-z][a-z0-9_.]*$' AND char_length(scope) <= 100
  ),
  CONSTRAINT idempotency_keys_response_status_range CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  )
);

-- Cascata do usuário (spec 030): o único composto começa por `scope` e não serve a esta busca.
CREATE INDEX idempotency_keys_user_idx ON idempotency_keys (user_id);

-- Expurgo das chaves com mais de 24 h (spec 003, "Idempotência").
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- migrate:down

-- Índices e restrições caem com a tabela.
DROP TABLE idempotency_keys;
