# 0008 — Fila de tarefas e tempo real no PostgreSQL

Status: provisória (revisar se a instalação precisar de mais de um nó ou se o p95 passar de 300 ms por causa da fila)
Data: 2026-11-24

## Contexto

O sistema precisa de tarefas em segundo plano (e-mail, webhook do Mercado Pago, vencimento de assinatura, certificado) e de entrega sem recarregar a página (mensagens diretas e sino de notificações). O porte-alvo é nó único com 500 simultâneos.

## Decisão

- Tempo real (F2-02): Server-Sent Events. O navegador abre `GET /api/v1/stream` na `classroom-api` e na `admin-api`; a API é avisada pelo `LISTEN/NOTIFY` do PostgreSQL. O envio continua por HTTP comum.
- Tarefas (F2-04): fila em tabela do PostgreSQL (`jobs`), consumida por um contêiner `worker`, com novas tentativas e agendamento.
- Não há Redis nem Valkey, cache dedicado nem mensageria. As pastas `eventbus/` e `cache/` não são criadas, e não há AsyncAPI.

## Alternativas consideradas

- WebSocket: permitiria "digitando" e presença mais fina, mas exige protocolo próprio e ficaria fora do OpenAPI.
- Consulta periódica a cada 15 a 30 segundos: simples, mas lenta e com carga constante.
- Fila e cache em Valkey: mais um serviço para operar e fazer backup, sem necessidade neste porte.
- Tarefas dentro do processo da API: perdem-se em reinício e competem com as requisições.

## Consequências

- O PostgreSQL é o único serviço com estado; operação e backup ficam simples.
- Cada conexão SSE ocupa um socket na API; o teste de carga da Fase 7 do PLAN valida 500 conexões.
- `NOTIFY` não é durável: quem reconecta busca o que perdeu por HTTP (mensagens e notificações têm estado no banco).
- Mensagens diretas não têm indicador de digitação.
- Gatilho de revisão: necessidade de mais de um nó, ou p95 acima de 300 ms atribuível à fila. A revisão provável é introduzir Valkey para fila e fan-out.
- Detalhado em [005](../005-worker-e-fila.md), [021](../021-mensagens-diretas.md) e [024](../024-notificacoes-e-email.md).
