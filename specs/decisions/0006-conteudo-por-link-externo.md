# 0006 — Conteúdo por link externo

Status: aceita
Data: 2026-11-24

## Contexto

Aulas têm vídeos e arquivos de apoio, e ebooks são vendidos. Era preciso decidir se o nuva-edu armazena esses arquivos ou só aponta para eles.

## Decisão

- Vídeos (F1-09): só por link ou embed externo (YouTube não listado, Vimeo, Bunny Stream, Panda Video ou arquivo `.mp4`/`.m3u8` direto). O sistema não armazena nem transcodifica vídeo.
- Ebooks e arquivos de apoio (F1-10): só por link externo informado pelo autor. Não há armazenamento próprio, MinIO nem S3. Escolhido contra a recomendação de upload com link assinado.
- O link só é entregue pela API a quem tem direito de acesso ao item.

## Alternativas consideradas

- Vídeos com upload próprio: exigiria armazenamento grande, transcodificação e banda.
- Ebooks e arquivos por upload em armazenamento compatível com S3, com link temporário assinado (recomendada, por proteger o ebook vendido).
- Upload em volume local servido pela API após checar o acesso.

## Consequências

- Risco aceito: quem recebe o link de um ebook ou arquivo pode repassá-lo; o sistema não tem como impedir. A proteção de vídeo depende do serviço externo escolhido pelo autor.
- Nenhum serviço de armazenamento de objetos no compose; o backup do Postgres cobre todo o estado do sistema (as imagens ficam no banco, ver [0007](0007-imagens-no-postgres.md)).
- A conclusão automática de aula depende de o player externo informar o fim do vídeo (F1-20).
- Link quebrado é falha externa prevista: aviso ao aluno e botão "reportar" que abre chamado (A-05).
- Upload de vídeo e de arquivo fica fora de escopo (ver [0017](0017-escopo-do-mvp.md)).
- Detalhado em [009](../009-catalogo-e-conteudo.md) e [014](../014-aprendizado-e-progresso.md).
