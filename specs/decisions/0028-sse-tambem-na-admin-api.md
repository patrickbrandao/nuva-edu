# 0028 — SSE também na admin-api

Status: aceita (substitui o recorte de distribuição do SSE entre as APIs na [0004](0004-duas-apis-um-banco.md))
Data: 2026-11-26

## Contexto

A [0008](0008-fila-e-sse-no-postgres.md) já decidiu Server-Sent Events com `LISTEN/NOTIFY` no PostgreSQL, sem definir claramente se o admin teria fluxo próprio. A [0004](0004-duas-apis-um-banco.md) e a spec 004 descreviam o fluxo apenas na `classroom-api`; a spec 006 também marcava o sino como exclusivo do classroom. Para as notificações da Fase 4, o humano decidiu na tarefa 500 que o sino do admin usa SSE no próprio host, reutilizando a infraestrutura de eventos, sem autenticação cruzada com o classroom.

## Decisão

- `GET /api/v1/stream` existe nas duas APIs desde a Fase 4. A `classroom-api` mantém alunos, equipe na comunidade, mensagens, fórum, novidades e notificações; a `admin-api` entrega somente `notification.created` destinado ao usuário da sessão administrativa.
- Cada API autentica o próprio cookie. A admin-api recusa sessão apenas `student` com `403 permission_denied`; nenhuma sessão do classroom é aceita no admin e vice-versa.
- As duas reutilizam o canal `nuva_user_events`, a sequência `user_event_id_seq`, `publishUserEvent`, o formato dos eventos, os limites, o reenvio e a recuperação por recarga. Cada processo mantém sua escuta e seu hub; evento de outro tipo recebido pelo admin é descartado, sem entrega nem reenvio. Não surgem canal, sequência, tabela ou serviço paralelos.
- A base comum do hub, parser e filtragem por tipo fica em `packages/api-kit`, com a instrumentação SSE já existente. A autenticação, a autorização, a seleção das consultas e a validação contra o contrato permanecem em cada API.
- As duas separações de processo e os dois contratos OpenAPI permanecem. Esta ADR não une APIs, não cria acesso administrativo na classroom-api e não muda a decisão de PostgreSQL nem o modelo de venda.
- O Traefik tem roteador próprio para o stream de cada host. As regras de sessão, suspensão, métricas, reconexão e proxy estão nas specs 003, 004, 024, 031 e 033.

## Alternativas consideradas

- Polling ou recarga no admin: foi descartado pelo humano; não aproveita a infraestrutura já aceita e cria comportamento diferente para o mesmo tipo de notificação.
- O admin assinar o SSE do classroom com outro cookie ou token compartilhado: mistura domínios de autenticação e expõe eventos que não pertencem ao painel.
- Unificar as APIs para ter um único fluxo: contraria a decisão de isolar a superfície administrativa e não é necessário para compartilhar uma biblioteca e um canal.
- Manter o hub na classroom-api e importá-lo diretamente pela admin-api: cria dependência entre aplicações e quebra a propriedade dos pacotes; a extração para `api-kit` evita as duas coisas.

## Consequências

- A tarefa 630 extrai a base SSE da classroom-api para `packages/api-kit` antes da janela 580, preservando os testes e o comportamento existentes. A janela publica o contrato do admin e inclui a tarefa 631 para a rota, sua configuração e seus testes.
- A tarefa 629 ajusta o roteamento do proxy e a CSP dos sites; o e2e 625 cobre o sino e a reconexão dos dois hosts.
- Duas APIs passam a manter conexões e escutas, dentro do mesmo limite global de recursos da instalação; o estado persistido das notificações continua sendo a recuperação após perda de evento.
