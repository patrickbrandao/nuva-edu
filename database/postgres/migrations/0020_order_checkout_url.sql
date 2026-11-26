-- 0020: URL e identificador do checkout no pedido (specs 011, "Interfaces e contratos" e "Dados",
-- e 013, "Interface PaymentProvider"; tarefas 530 e 699).
-- `createCheckout` devolve `checkout_url` e `provider_checkout_id` (013), mas a 0014 não tinha
-- onde guardá-los: a consulta do pedido (tarefa 540), o cancelamento do checkout e o vencimento
-- precisam relê-los depois da resposta HTTP, sem chamar o provedor de novo.
--
-- Decisões de esquema que a spec não fixa:
-- - As duas colunas são nulas e sem valor padrão. O pedido de total zero não passa pelo provedor
--   (provider = 'none') e o pedido que ficou `draft` por indisponibilidade do provedor continuam
--   com as duas nulas; só o fechamento que criou o checkout as preenche.
-- - Sem CHECK de formato: a URL e o identificador são do provedor e podem mudar de forma entre
--   eles (013 lista a interface, não o formato). Validar aqui prenderia o esquema a um provedor.
-- - Sem índice: a leitura é sempre pelo pedido já carregado (chave primária) e o cancelamento usa
--   `provider_checkout_id` da própria linha; não há busca por URL nem por identificador do provedor.
-- - Sem reescrita de dado: `ADD COLUMN` sem valor padrão é só catálogo. `down` apaga as duas
--   colunas; como a 530 ainda não as grava, nenhuma linha existente perde informação.

-- migrate:up
ALTER TABLE orders
  ADD COLUMN checkout_url text,
  ADD COLUMN provider_checkout_id text;

-- migrate:down
ALTER TABLE orders
  DROP COLUMN provider_checkout_id,
  DROP COLUMN checkout_url;
