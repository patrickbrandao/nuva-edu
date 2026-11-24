# 0018 — Vitrine pública como SPA

Status: provisória (revisar se a indexação em buscadores se mostrar insuficiente)
Data: 2026-11-24

## Contexto

O classroom tem páginas visíveis sem login, que servem para vender e para prova social. Os sites são SPAs em React ([0010](0010-interface-minui-em-packages-ui.md)), e SPA pura é indexada de forma menos confiável pelos buscadores.

## Decisão

- (F2-13) Sem login, o visitante vê: a vitrine (cursos, pacotes, ebooks e planos não privados, com descrição, preço e programa, sem as aulas), a página de validação de certificado e os cases públicos. Comprar, assistir, fórum e o restante da comunidade exigem login. Publicar um case exige aceite explícito de exibição pública.
- (S-07) A vitrine é uma SPA pura, com título, descrição e Open Graph por página. Não há renderização no servidor nem pré-renderização no MVP.

## Alternativas consideradas

- Visitante vê só a tela de login: a divulgação dependeria de páginas externas.
- Vitrine sem cases públicos (recomendada): evitaria expor nome e conteúdo de alunos a visitantes.
- Pré-renderização ou renderização no servidor das páginas públicas: mais um modo de build ou um serviço a mais; adiada.

## Consequências

- Os endpoints de vitrine, de validação de certificado e de cases públicos da `classroom-api` não exigem sessão e não devolvem dado restrito; isso tem teste.
- Risco aceito: cases públicos expõem nome e conteúdo de alunos; o aceite na publicação é registrado, e o aluno pode despublicar.
- Gatilho de revisão: páginas da vitrine não indexadas ou mal apresentadas em buscadores e em prévias de link. A revisão provável é pré-renderizar as rotas públicas.
- Detalhado em [006](../006-sites-e-interface.md), [009](../009-catalogo-e-conteudo.md), [015](../015-certificados.md) e [022](../022-cases.md).
