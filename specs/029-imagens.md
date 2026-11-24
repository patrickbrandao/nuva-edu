# 029 — Imagens enviadas

Status: aprovada
Depende de: 001, 003, 004, 005

## Contexto

Avatar, capa de perfil, capa de curso, pacote, ebook e evento, e a galeria dos cases são imagens enviadas por usuários. Vídeos, ebooks e arquivos de apoio são links externos e não passam por aqui. As imagens ficam dentro do PostgreSQL, para que um único backup cubra toda a instalação; por isso os limites desta spec são rígidos.

## Requisitos

- RF-01: Tipos aceitos no envio: JPEG, PNG e WebP. O tipo é detectado pelo conteúdo do arquivo, não pela extensão nem pelo cabeçalho informado.
- RF-02: Toda imagem é decodificada, tem os metadados removidos (EXIF, GPS), é redimensionada e regravada em WebP antes de ir ao banco. O arquivo original não é guardado.
- RF-03: Cada imagem gera variantes conforme a finalidade (tabela abaixo).
- RF-04: A entrega é por rota própria, com URL que muda quando o conteúdo muda, cache longo e `ETag`.
- RF-05: Imagem sem referência (envio abandonado, avatar trocado, case apagado) é removida pelo expurgo diário.
- RF-06: SVG, GIF animado e qualquer outro formato são recusados com erro 415.
- RNF-01: Tamanho máximo do envio: 5 MB (`NUVA_IMAGE_MAX_UPLOAD_MB`). Acima disso, erro 413 antes de ler o corpo inteiro.
- RNF-02: Dimensão máxima aceita na entrada: 8000 px no maior lado e 40 megapixels; acima disso, erro 422 (proteção contra bomba de descompressão).
- RNF-03: Nenhuma variante gravada passa de 1600 px no maior lado nem de 400 KB.
- RNF-04: Um case tem no máximo 8 imagens (`NUVA_CASE_MAX_IMAGES`).
- RNF-05: Limite de 30 envios por usuário por hora (`NUVA_IMAGE_UPLOADS_PER_HOUR`); a equipe não tem esse limite.
- RNF-06: Entrega de uma variante já em cache do navegador custa zero requisições; a primeira entrega responde em menos de 100 ms (p95).
- RNF-07: O processamento de um envio de 5 MB termina em menos de 2 s (p95) com 1 vCPU.

## Comportamento

### Finalidades e variantes

| Finalidade (`purpose`) | Quem envia | Variantes (maior lado, corte) |
| --- | --- | --- |
| `avatar` | Qualquer usuário | 64, 256 (quadrado) |
| `profile_cover` | Qualquer usuário | 480, 1600 (4:1) |
| `product_cover` | `instructor`, `manager`, `admin` | 480, 1280 (16:9) |
| `event_cover` | `manager`, `admin` | 480, 1280 (16:9) |
| `case_image` | Usuário com acesso ativo | 480, 1600 (proporção original) |
| `content_image` | `instructor`, `manager`, `admin` | 1600 (proporção original); usada em descrições e novidades |
| `school_logo` | `admin` | 64, 256, 512 (proporção original) |

O `logoUrl` do `/meta` ([003](003-admin-api.md)) aponta para a variante de 256 do `school_logo`; as de 64 e 512 ficam para quem precisar de outro tamanho (ícone, tela de alta densidade).

Qualidade WebP 80; se a variante passar de 400 KB, a qualidade cai em passos de 10 até 50 e, se ainda passar, o envio é recusado com erro 422.

### Fluxo de envio

1. O cliente envia `multipart/form-data` com o arquivo e o `purpose`.
2. A API confere permissão, limite por hora e tamanho.
3. Detecta o tipo, valida dimensões, processa as variantes e grava `images` e as variantes numa transação.
4. Responde com `image_id` e as URLs das variantes.
5. O cliente usa o `image_id` ao salvar o perfil, o curso ou o case. Só então a imagem passa a ter referência.

Detalhes do envio:

- Campos do `multipart/form-data`: `purpose` (texto, primeiro) e `file` (o arquivo, um só). Campo a mais, segundo arquivo ou `purpose` ausente: `400` `validation_failed`.
- Finalidade que o site não aceita ou que o papel não pode enviar: `403` `permission_denied`.
- Resposta `201`: `{ "id", "purpose", "width", "height", "variants": [{ "width", "height", "url" }] }`, com `url` no formato da entrega.
- Códigos próprios: `413` `payload_too_large`; `415` `image_type_unsupported`; `422` `image_dimensions_exceeded` (RNF-02) e `image_too_heavy` (variante acima de 400 KB mesmo na qualidade 50); `429` `rate_limited`; `503` `image_processing_busy` com `Retry-After`.
- Biblioteca de processamento: `sharp` (libvips), em `packages/core` (módulo `images`), que roda nas duas APIs.

Na Fase 1 só existe a finalidade `avatar`, enviada pelo classroom ([007](007-contas-e-autenticacao.md), "Avatar"); o admin só entrega imagens. As demais finalidades entram com os recursos que as usam, e a referência de `avatar` é `profiles.avatar_image_id`.

O processamento acontece na API (não na fila), porque o usuário espera o resultado; a API limita a 2 processamentos simultâneos por instância e devolve 503 com `Retry-After` quando a fila interna passa de 10.

### Entrega

- URL: `/api/v1/images/{image_id}/{variant}.webp`, em que `variant` é a largura (`64`, `256`, `480`, `512`, `1280`, `1600`). Cada imagem só tem as variantes da sua finalidade (tabela acima); pedir outra largura devolve 404.
- O `image_id` nunca é reutilizado: trocar o avatar cria outra imagem e outra URL.
- Resposta: `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `ETag` com o hash do conteúdo, `X-Content-Type-Options: nosniff`.
- `If-None-Match` igual ao `ETag` devolve 304.
- Imagens são públicas por URL (o identificador é UUID, não adivinhável). Não há imagem privada nesta versão: nada sigiloso deve ser enviado como imagem.
- Imagem de conteúdo ocultado pela moderação ([026](026-moderacao-e-denuncias.md)) passa a devolver 404.
- As duas APIs servem a rota de entrega; só a API do site em uso aceita o envio daquela finalidade.

### Expurgo

A tarefa diária `image.cleanup` do worker ([005](005-worker-e-fila.md)) apaga as imagens sem referência há mais de 24 horas. A referência é mantida por chaves estrangeiras das tabelas donas (`profiles`, `courses`, `bundles`, `ebooks`, `events`, `case_images`, `settings`) e por uma tabela de uso para `content_image`.

### Gatilho de revisão

Esta decisão é provisória. O admin vê, na tela de operação ([033](033-observabilidade-retencao-backup.md)), o total ocupado por imagens. Revisar para armazenamento externo quando o banco passar de 20 GB ou o backup passar de 30 minutos.

## Interfaces e contratos

- `POST /api/v1/images` — envio; em `apps/admin-api/openapi.yaml` e `apps/classroom-api/openapi.yaml`, cada um com as finalidades do seu site.
- `GET /api/v1/images/{image_id}/{variant}.webp` — entrega, nos dois contratos, sem autenticação.
- `DELETE /api/v1/images/{image_id}` — só para imagem ainda sem referência, por quem a enviou.

## Dados

| Tabela | Campos principais |
| --- | --- |
| `images` | `id`, `owner_user_id`, `purpose`, `original_width`, `original_height`, `created_at`, `hidden_at` |
| `image_variants` | `image_id`, `width`, `height`, `bytes`, `sha256`, `data` (bytea) |

- Dono: a API que recebeu o envio escreve; o worker apaga órfãs.
- `image_variants.data` usa armazenamento `EXTERNAL` (WebP já é comprimido; evita recompressão pelo banco).
- Consultas de listagem nunca selecionam `data`.

Decisões de esquema da migration 0004 (aceitas na tarefa 198):

- `image_variants.sha256` é o SHA-256 de `data` em hexadecimal minúsculo (64 caracteres), conferido por `CHECK`. É o `ETag` da entrega, entre aspas (`ETag: "<sha256>"`).
- `image_variants.width` é o nome da variante na URL e faz parte da chave (`image_id`, `width`); o banco aceita só os seis valores (`64`, `256`, `480`, `512`, `1280`, `1600`). `height` é a altura gravada, de 1 a 1600. `bytes` é o tamanho de `data` (de 1 a 400 KB), conferido contra ela.
- O banco não amarra a largura à finalidade: gerar só as variantes da finalidade (tabela de "Finalidades e variantes") e devolver 404 para outra largura é do código.
- Com isso, a variante tem exatamente a largura do nome. Nas finalidades com corte (`avatar`, `profile_cover`, `product_cover`, `event_cover`) a imagem é cortada na proporção e redimensionada para essa largura, ampliando quando o original é menor; a altura sai da proporção (no máximo 400 px em 4:1 e 720 px em 16:9), dentro do teto de RNF-03.
- Em aberto: nas finalidades de proporção original (`case_image`, `content_image`, `school_logo`), uma imagem mais alta que larga não cabe em "largura = nome" sem passar de 1600 px de altura. A regra (por exemplo, o nome passar a ser o teto do maior lado, com uma coluna para a largura real) é fixada pelo `arquiteto` antes da fase que introduz a primeira delas; na Fase 1 só existe `avatar`.
- Retenção: enquanto houver referência; órfãs, 24 horas. Na exclusão de conta ([030](030-lgpd.md)), avatar, capa e imagens de cases do usuário são apagados.

## Critérios de aceite

- [ ] Arquivo `.png` com conteúdo SVG ou executável é recusado com 415.
- [ ] Envio de 6 MB é recusado com 413; imagem de 9000 px é recusada com 422.
- [ ] JPEG com EXIF de GPS resulta em variantes sem nenhum metadado.
- [ ] Nenhuma variante gravada passa de 1600 px nem de 400 KB.
- [ ] A nona imagem de um case é recusada.
- [ ] A segunda requisição da mesma URL com `If-None-Match` devolve 304.
- [ ] Imagem enviada e não usada some após o expurgo; imagem em uso permanece.
- [ ] O 31º envio na mesma hora devolve 429.

## Fora de escopo

- Armazenamento em S3, MinIO ou volume local.
- Upload de vídeo, PDF, ebook ou qualquer arquivo que não seja imagem.
- Imagens privadas, com controle de acesso por direito.
- Editor de corte no servidor (o corte é central e automático; o ajuste fino é feito no navegador antes do envio).
- CDN própria.

## Decisões relacionadas

- [0007 — Imagens no PostgreSQL (provisória)](decisions/0007-imagens-no-postgres.md)
- [0006 — Conteúdo por link externo](decisions/0006-conteudo-por-link-externo.md)
