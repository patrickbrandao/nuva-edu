-- 0004: imagens enviadas e suas variantes WebP (spec 029).
-- Dono dos dados: a API que recebeu o envio escreve; o worker apaga as órfãs (image.cleanup).

-- migrate:up

CREATE TABLE images (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Quem enviou. A chave estrangeira para users entra na 0005, que cria a tabela.
  owner_user_id uuid NOT NULL,
  purpose text NOT NULL,
  -- Dimensões da imagem recebida, antes do redimensionamento (o original não é guardado).
  original_width integer NOT NULL,
  original_height integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Conteúdo ocultado pela moderação (spec 026): a entrega passa a devolver 404.
  hidden_at timestamptz,
  CONSTRAINT images_purpose_valid CHECK (
    purpose IN (
      'avatar',
      'profile_cover',
      'product_cover',
      'event_cover',
      'case_image',
      'content_image',
      'school_logo'
    )
  ),
  -- RNF-02: até 8000 px no maior lado e 40 megapixels; acima disso a API já recusa com 422.
  CONSTRAINT images_original_width_range CHECK (original_width BETWEEN 1 AND 8000),
  CONSTRAINT images_original_height_range CHECK (original_height BETWEEN 1 AND 8000),
  CONSTRAINT images_original_pixels_range CHECK (
    original_width::bigint * original_height <= 40000000
  )
);

-- Expurgo diário das órfãs (RF-05): WHERE created_at < now() - interval '24 hours'
-- AND NOT EXISTS (referência nas tabelas donas).
CREATE INDEX images_created_at_idx ON images (created_at);

-- Envios do usuário na última hora (RNF-05) e imagens do usuário na exclusão de conta (spec 030):
-- WHERE owner_user_id = $1 [AND created_at > now() - interval '1 hour'].
-- Serve também à chave estrangeira que a 0005 acrescenta.
CREATE INDEX images_owner_created_idx ON images (owner_user_id, created_at);

CREATE TABLE image_variants (
  image_id uuid NOT NULL,
  -- Nome da variante na URL (/api/v1/images/{image_id}/{width}.webp).
  width integer NOT NULL,
  height integer NOT NULL,
  -- Tamanho de data em bytes (RNF-03: até 400 KB), guardado para listar sem ler data.
  bytes integer NOT NULL,
  -- SHA-256 de data em hexadecimal minúsculo: o ETag da entrega.
  sha256 text NOT NULL,
  -- WebP. Consultas de listagem nunca selecionam esta coluna.
  data bytea NOT NULL,
  CONSTRAINT image_variants_pkey PRIMARY KEY (image_id, width),
  CONSTRAINT image_variants_image_id_fkey FOREIGN KEY (image_id)
    REFERENCES images (id) ON DELETE CASCADE,
  CONSTRAINT image_variants_width_valid CHECK (width IN (64, 256, 480, 512, 1280, 1600)),
  -- RNF-03: nenhuma variante passa de 1600 px no maior lado.
  CONSTRAINT image_variants_height_range CHECK (height BETWEEN 1 AND 1600),
  CONSTRAINT image_variants_bytes_range CHECK (bytes BETWEEN 1 AND 409600),
  CONSTRAINT image_variants_bytes_matches_data CHECK (bytes = octet_length(data)),
  CONSTRAINT image_variants_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

-- WebP já é comprimido: guarda fora da linha (TOAST) sem tentar comprimir de novo.
ALTER TABLE image_variants ALTER COLUMN data SET STORAGE EXTERNAL;

-- migrate:down

DROP TABLE image_variants;
DROP TABLE images;
