# 0007 — Imagens enviadas ficam no PostgreSQL

Status: provisória (revisar se o banco passar de 20 GB ou o backup passar de 30 minutos)
Data: 2026-11-24

## Contexto

A decisão de conteúdo por link externo ([0006](0006-conteudo-por-link-externo.md)) cobre vídeos, ebooks e arquivos, mas avatar, capa de perfil, capa de curso e galeria de cases são imagens enviadas pelo usuário e precisam ser guardadas.

## Decisão

(F2-03) As imagens enviadas são validadas, redimensionadas e gravadas no PostgreSQL, na tabela `images` (coluna `bytea`), e servidas pela API com cache longo. Escolhido contra a recomendação de volume local.

Há limite de tamanho por imagem e de quantidade por galeria de case, definidos em [029](../029-imagens.md), para conter o crescimento do banco.

## Alternativas consideradas

- Volume Docker local servido pela API (recomendada): sem serviço extra, mas um segundo artefato a incluir no backup.
- Armazenamento compatível com S3 (MinIO ou externo): escala para vários nós, mas traz o serviço que o usuário preferiu evitar.
- Só URL externa: experiência ruim e imagens que somem.

## Consequências

- Um único `pg_dump` cobre todo o estado da instalação, inclusive imagens.
- O banco e os dumps crescem com as imagens; a galeria de cases é o maior fator. Os limites da spec 029 são a contenção.
- Servir imagem consome conexão do banco; cabeçalhos de cache longo e ETag são obrigatórios.
- Gatilho de revisão: banco acima de 20 GB ou backup acima de 30 minutos. A revisão provável é mover os bytes para volume ou S3 mantendo a tabela `images` como índice.
