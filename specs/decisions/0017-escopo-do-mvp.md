# 0017 — Escopo do MVP

Status: aceita
Data: 2026-11-24

## Contexto

Além do núcleo descrito pelo usuário (cursos, pacotes, ebooks, aulas, fórum), os 25 prints da plataforma de inspiração mostraram muitos recursos de aprendizado, comunidade e suporte. Cada um foi discutido para decidir se entra no MVP.

## Decisão

Entram no MVP:

- Aprendizado (F1-12): progresso e estante "Meus cursos", certificado de conclusão, anotações e calendário de lives.
- Comunidade (F1-13): diretório de membros e perfil rico, gamificação, mensagens diretas 1:1 e cases. Escolhido contra a recomendação de adiar todos esses.
- Conversa (F1-14): só fórum; não há canais de chat em tempo real.
- Suporte (F1-15): chamados de suporte, central de notificações com e-mail transacional e novidades da escola.

Fora de escopo (P-09): canais de chat, upload de vídeo ou de arquivo, questionários e provas, nota fiscal, repasse a instrutor, multi-tenant, app nativo, afiliados, resumo semanal por e-mail, "Presentes" e "Postagens salvas".

Ritmo (F1-27): não há data fixa; o usuário trabalha sozinho com agentes e as entregas são por fase. A ordem do PLAN é: 0 Fundação, 1 Contas, 2 Catálogo e aprendizado, 3 Vendas, 4 Fórum e suporte, 5 Administração por MCP, 6 Comunidade, 7 Versão 1.0.

## Alternativas consideradas

- Comunidade fora do MVP, com o fórum e um perfil básico cobrindo a interação (recomendada).
- Fórum mais canais de chat em tempo real: dobraria a superfície de moderação e exigiria outro serviço.
- Resumo semanal por e-mail no MVP: adiado.
- Uma data de lançamento com corte de escopo: o usuário preferiu não fixar data.

## Consequências

- Risco aceito: o MVP é amplo. O PLAN escalona para que vender e ensinar (Fases 1 a 3) fiquem utilizáveis antes da comunidade (Fase 6).
- Mensagens diretas e notificações exigem tempo real, resolvido por SSE ([0008](0008-fila-e-sse-no-postgres.md)).
- Perfil, cases e avatar exigem guarda de imagens ([0007](0007-imagens-no-postgres.md)).
- Os itens fora de escopo só entram por ADR nova; pedidos que os envolvam são recusados pelos agentes com referência a esta ADR.
- Cada recurso do MVP tem spec própria, de [014](../014-aprendizado-e-progresso.md) a [026](../026-moderacao-e-denuncias.md); a visão geral está em [000](../000-visao-geral.md).
