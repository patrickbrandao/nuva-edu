# packages/core

Núcleo do nuva-edu (`@nuva-edu/core`): a base usada pelas duas APIs e pelo worker, e a única casa das regras de negócio. Dono: papel `nucleo` (specs/002).

Roda direto no Node 26, sem build: os imports levam `.ts` e a sintaxe é só a que o Node apaga.

| Caminho | Conteúdo |
| --- | --- |
| `src/config/` | Configuração lida e validada das variáveis de ambiente (spec 031) |
| `src/db/` | Conexão Kysely, estado do pool, escuta de canal (`LISTEN`) e tipos gerados do banco (`generated/`, não edite à mão) |
| `src/logging/` | Logger JSON e máscara de campos proibidos (spec 033) |
| `src/errors/` | Erro de domínio e conversão em problem+json (spec 003) |
| `src/modules/` | Uma pasta por área de negócio (veja o README de lá) |
| `src/modules/jobs/` | Fila de tarefas em segundo plano sobre a tabela `jobs` (spec 005) |
| `src/modules/settings/` | Configuração da escola na tabela `settings`: nome, fuso e marca (logotipo, cor, endereço do código-fonte) |
| `src/modules/images/` | Caminho de entrega das imagens (spec 029); o restante do módulo chega com a tabela `images` |
| `src/modules/stream/` | Eventos em tempo real para o usuário (`NOTIFY nuva_user_events`, spec 004) |
| `scripts/db-types.ts` | Gera os tipos do Kysely a partir do banco |
| `test/` | Testes (Vitest); os de banco usam um banco clonado do modelo |

## Uso

```ts
import {
  createDatabase,
  createLogger,
  loadConfigOrExit,
  PROBLEM_CONTENT_TYPE,
  resolveRequestId,
  toProblem,
} from '@nuva-edu/core';

// Variável obrigatória ausente ou inválida: uma linha JSON `fatal` citando a variável, e exit 1.
const config = loadConfigOrExit({ service: 'admin-api', required: ['SESSION_SECRET'] });
const logger = createLogger({ service: 'admin-api', level: config.logLevel });
const db = createDatabase({ connectionString: config.databaseUrl, applicationName: 'admin-api', logger });

const log = logger.withRequestId(resolveRequestId(request.headers['x-request-id']));
log.info('Requisição atendida', { route, status, duration_ms });

// No tratador de erros da API:
const problem = toProblem(error, { instance: request.url });
reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
```

## Configuração da instalação

`loadConfig` lê as variáveis da spec 031 e devolve um objeto já validado. Dois pontos que pedem atenção:

- **`NUVA_LOCALE`** é aceita sem diferenciar maiúsculas e guardada na forma canônica do `Intl`: `pt-br` vira `config.locale === 'pt-BR'`. Etiqueta fora do formato, ou que o `Intl` recusa (`pt-br-br`), impede a subida.
- **`TRUSTED_PROXIES`** define de quais origens o `X-Forwarded-For` e o `X-Real-IP` são aceitos. Definida, substitui a lista padrão inteira. O padrão (`DEFAULT_TRUSTED_PROXIES`) é:

| Faixa | O que é |
| --- | --- |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | Redes privadas (as do Docker caem aqui) |
| `100.64.0.0/10` | CGNAT |
| `127.0.0.0/8`, `::1/128` | Laço local |
| `169.254.0.0/16`, `fe80::/10` | Link-local |
| `fc00::/7` | Endereços locais únicos do IPv6 |

**Risco do padrão amplo:** um cliente cujo endereço real está numa dessas faixas (rede interna da escola, cliente atrás do mesmo CGNAT do servidor) é tratado como proxy, e o `X-Forwarded-For` que ele enviar é aceito: ele consegue forjar o IP que vai para o limite de tentativas de login, a auditoria e os logs. Quem atende usuários nessas condições deve restringir `TRUSTED_PROXIES` à rede do proxy, por exemplo `TRUSTED_PROXIES=172.18.0.0/16` (a sub-rede da rede Docker do Traefik).

## Logs: o que nunca sai

- Campo cujo nome contém `password`, `token`, `secret`, `authorization`, `cookie`, `cpf`, `cnpj`, `document`, `key` (e `senha`, `credential`, `cardnumber`, `cvv`) é trocado por `[REDACTED]`, em qualquer profundidade.
- Única exceção ao trecho `key`, por não guardarem segredo: `unique_key`, `setting_key`/`settings_key`, `translation_key` e `i18n_key`, em qualquer grafia (`uniqueKey`, `UNIQUE_KEY`). Um campo chamado só `key` continua mascarado (spec 033), assim como `apiKey`, `secretKey`, `privateKey`, `accessKey` e `keyId`: para registrar o nome de uma configuração, use o campo `setting_key`.
- Em texto livre é mascarado o que tem forma reconhecível: credencial em URL, `Bearer`/`Basic`, pares `senha=valor`, CPF e CNPJ.
- Uma senha solta no meio de uma frase não tem forma: **nunca interpole senha, token ou chave numa mensagem**. Passe como campo, que a máscara cobre.
- O log de consultas traz só o SQL, sem parâmetros; `detail` e `where` dos erros do PostgreSQL são mascarados, porque reproduzem valores das linhas.

## Fila de tarefas

Fila no PostgreSQL (spec 005). As APIs só enfileiram (e reenfileiram pelo `/ops`); o restante é do worker.

```ts
// API: junto com a escrita de negócio. Desfeita a transação, a tarefa não existe.
await db.transaction().execute(async (trx) => {
  // ... escrita de negócio ...
  await enqueue(trx, 'example.echo', { message: 'olá' }, { uniqueKey: 'echo:42' });
});

// Worker: acorda pelo NOTIFY, e varre a cada SWEEP_INTERVAL_MS de qualquer forma.
const listener = listenForJobs({ connectionString: config.databaseUrl, onNotify: wake, logger });
const jobs = await claimJobs(db, { workerId, limit: livres });
for (const job of jobs) {
  const lock = { jobId: job.id, workerId };
  try {
    if (!isKnownJob(job)) throw new Error(`Tipo de tarefa desconhecido: ${job.type}`);
    await run(job); // switch (job.type) estreita o payload
    await completeJob(db, lock);
  } catch (error) {
    await failJob(db, { ...lock, error }); // nova tentativa com espera crescente, ou failed
  }
}
```

| Função | Uso |
| --- | --- |
| `enqueue(db, tipo, payload, { runAt, priority, maxAttempts, uniqueKey })` | Enfileira; `null` se a `uniqueKey` já tem tarefa `queued` ou `running` |
| `enqueueRecurring(db, tipo, payload, { window })` | Recorrente da janela (`tipo:janela`), uma única vez em qualquer estado |
| `claimJobs(db, { workerId, limit })` | Pega tarefas prontas com `SKIP LOCKED`; cada claim conta uma tentativa |
| `heartbeatJobs(db, { workerId, jobIds })` | Renova o batimento (a cada `HEARTBEAT_INTERVAL_MS`); devolve os ids ainda travados |
| `completeJob` / `failJob` / `releaseJob` | Conclui, registra falha (`last_error` mascarado) ou devolve à fila no encerramento |
| `requeueStaleJobs(db)` | Tarefa `running` sem batimento há `STALE_AFTER_MS` volta à fila, ou falha se esgotou |
| `retryJob(db, id)` | Reenfileira uma `failed` (tela `/ops`) |
| `getJobCounts(db)` / `getJobCountsByType(db)` | Contagens para `/metrics` e `/ops` |
| `getOldestPendingJobAgeSeconds(db)` | Espera da pendente mais antiga, para `jobs_oldest_pending_seconds`; 0 sem pendentes |
| `listenForJobs({ connectionString, onNotify })` | `LISTEN nuva_jobs` em conexão dedicada, com reconexão |

Os manipuladores (`JobHandlers`) recebem a tarefa e um contexto `{ signal }`: o worker aborta o `AbortSignal` no encerramento ou ao perder a trava, e manipulador longo o repassa a `fetch` e esperas.

Tipo novo de tarefa: acrescente em `JobPayloads` e `JOB_DEFINITIONS` (`src/modules/jobs/registry.ts`), com o nome do catálogo da spec 005. Payload leva só identificadores.

## Configuração da escola

Tabela `settings`; a escrita é da admin-api, os demais só leem.

| Chave | Valor | Padrão |
| --- | --- | --- |
| `school.name` | Nome da escola (texto de 1 a 120 caracteres, sem espaços nas pontas) | `nuva-edu` |
| `school.timezone` | Fuso IANA | `America/Sao_Paulo` |
| `school.logo_image_id` | UUID de uma imagem (spec 029) ou nulo | nulo |
| `school.accent_color` | Cor `#RRGGBB` ou nulo | nulo |
| `school.source_code_url` | URL `https`, até 2048 caracteres, sem usuário e senha | `https://github.com/patrickbrandao/nuva-edu` |

Chave ausente vale o padrão: a instalação nova não tem linha nenhuma. Valor inválido gravado por fora também vale o padrão, com um aviso `warn` que cita só a chave (`setting_key`); para o aviso sair, passe o `logger` ao leitor.

```ts
// Um leitor por processo: uma consulta a cada 30 s (SETTINGS_CACHE_TTL_MS) serve todas as chaves.
const settings = createSettingsReader(db, { logger });
const schoolName = await settings.schoolName();

// Campos de marca do /meta (spec 003).
const values = await settings.all();
const meta = {
  schoolName: values['school.name'],
  logoUrl: schoolLogoUrl(values['school.logo_image_id']), // '/api/v1/images/<id>/256.webp' ou null
  accentColor: values['school.accent_color'],
  sourceCodeUrl: values['school.source_code_url'],
};

// admin-api, ao salvar: valor inválido lança validation_failed.
await setSetting(db, 'school.name', body.value);
settings.invalidate(); // os outros processos enxergam quando o cache deles vencer
```

Sem cache: `getSchoolName(db)`, `getSchoolTimezone(db)`, `getSetting(db, chave, { logger })`, `getSettings(db, { logger })`.

`school.logo_image_id` tem só o formato conferido (UUID ou nulo): a tabela `images` ainda não existe, então nada garante aqui que a imagem existe. `schoolLogoUrl(id, largura = 256)` e `imagePath(id, largura)` são funções puras que montam o caminho da rota de entrega (`/api/v1/images/{image_id}/{variant}.webp`), sem ir ao banco.

## Eventos em tempo real e escuta de canal

```ts
// Quem grava a mudança publica na mesma transação; o aviso só sai no COMMIT.
await publishUserEvent(trx, {
  userId,
  kind: 'dm.message.created',
  data: { conversationId, messageId }, // só identificadores
});

// classroom-api: uma conexão dedicada por processo, com reconexão.
const listener = listenChannel({
  connectionString: config.databaseUrl,
  channel: USER_EVENTS_CHANNEL,
  onNotification: (payload) => hub.dispatch(payload),
  logger,
});
```

- O `data` é tipado pelo `kind` (`UserEventData`, o mesmo mapa dos esquemas do contrato): evento com formato errado não compila.
- A carga do `NOTIFY` é `{ userId, kind, id, data }`. O `id` vem da sequência `user_event_id_seq` (migration 0003); `{ nextId }` troca o gerador.
- Carga de 8000 bytes ou mais não cabe no NOTIFY: lança `user_event_too_large` e nada é publicado.
- `listenForJobs` é `listenChannel` com o canal da fila.

## Estado do pool

`databasePoolStats(db)` devolve `{ total, idle, active, waiting, max }` em memória, para o medidor `db_pool_connections{state}` (spec 033).

## Tipos do banco

```bash
pnpm --filter @nuva-edu/core db:types         # depois de cada migration nova
pnpm --filter @nuva-edu/core db:types:check   # falha se os tipos estiverem desatualizados
```

As colunas `snake_case` aparecem em `camelCase` no código (`CamelCasePlugin`). SQL escrito à mão com `sql` continua em `snake_case`.

## Testes

```bash
pnpm --filter @nuva-edu/core test            # precisa do Postgres local no ar
pnpm --filter @nuva-edu/core test:coverage   # falha abaixo de 80% de linhas
pnpm --filter @nuva-edu/core typecheck
```
