# 0020 — Eventos de usuário do SSE: id por sequência e reenvio em memória

Status: provisória (revisar se um usuário relatar perda de evento ou se a instalação passar a ter mais de um processo de classroom-api)
Data: 2026-11-24

## Contexto

A [0008](0008-fila-e-sse-no-postgres.md) decidiu SSE com `LISTEN/NOTIFY`, mas não disse quem monta o evento, de onde vem o `id` nem como funciona o reenvio por `Last-Event-ID`. O esqueleto da `classroom-api` implementou o reenvio com os eventos guardados na memória do processo, e a pergunta ficou aberta: isso basta ou é preciso uma tabela de eventos?

## Decisão

- A carga do `NOTIFY nuva_user_events` é `{ userId, kind, id, data }`. `data` é o corpo do evento como vai ao navegador, só com identificadores e contadores.
- O `id` vem da sequência `user_event_id_seq` do PostgreSQL: crescente para todos os processos que publicam (APIs e worker), sem coordenação entre eles. É crescente por usuário, não consecutivo.
- Só `publishUserEvent`, de `packages/core`, publica no canal, dentro da transação da escrita que originou o evento.
- Cargas de 8000 bytes ou mais (limite do `NOTIFY`) são recusadas com erro por `publishUserEvent`. O evento não carrega conteúdo; o cliente o busca pela API, que checa permissão.
- O reenvio por `Last-Event-ID` usa a memória do processo: 5 minutos, até 500 eventos por usuário. Não há tabela de eventos.

## Alternativas consideradas

- Tabela `user_events` com expurgo: reenvio que sobrevive a reinício e funciona com vários processos, ao custo de uma escrita a mais por evento, expurgo e mais uma tabela quente. O estado que importa (mensagens, notificações) já está no banco.
- `id` gerado pela API que entrega: dois processos gerariam sequências diferentes, e o `Last-Event-ID` perderia o sentido ao reconectar em outro processo.
- `id` por usuário (contador numa tabela): consecutivo, mas exige travar uma linha por evento.
- Evento com o conteúdo (texto da mensagem): esbarra no limite do `NOTIFY` e entregaria conteúdo sem passar pela checagem de permissão da rota.

## Consequências

- O reenvio cobre a queda de rede do navegador. Não cobre reinício da API, queda da conexão `LISTEN` nem um segundo processo. Por isso a interface recarrega as listas afetadas a cada reconexão, e nenhuma tela depende de ter recebido todos os eventos.
- Memória: no pior caso, 500 eventos pequenos por usuário ativo nos últimos 5 minutos, dentro da RNF-02 da spec 004.
- Uma sequência a mais no banco (migration 0003), sem tabela.
- Gatilho de revisão: perda de evento relatada, ou mais de um processo de `classroom-api` (o que também aciona a revisão da 0008). A revisão provável é a tabela `user_events` com reenvio lido do banco.
- Detalhado em [004](../004-classroom-api.md) ("Fluxo SSE" e "Reenvio na reconexão").
