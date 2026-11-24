# database/postgres

Esquema do PostgreSQL 18 do nuva-edu: migrations em SQL puro, o comando que as aplica e o banco modelo dos testes. Dono: papel `banco` (specs/002). Pacote do workspace: `@nuva-edu/database`.

| Caminho | Conteúdo |
| --- | --- |
| `docker-compose.yml` | Serviço `postgres` (papel `infra`) |
| `migrations/` | Um arquivo `.sql` por migration |
| `src/` | Comando `migrate` e funções do banco modelo |
| `test/` | Testes do mecanismo e das migrations |

## Comando

```bash
pnpm db:migrate up                # aplica as pendentes
pnpm db:migrate up --to 3         # aplica até a 0003
pnpm db:migrate down              # desfaz a última
pnpm db:migrate down --steps 2    # desfaz as duas últimas
pnpm db:migrate down --to 0       # desfaz todas
pnpm db:migrate status            # aplicada | pendente | alterada | sem-arquivo
pnpm db:migrate template          # cria ou atualiza o banco modelo dos testes
```

Conexão: `DATABASE_URL`; sem ela, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST` (padrão `127.0.0.1`) e `NUVA_POSTGRES_PORT`. O comando lê também `.env.local` e `.env` da raiz, sem sobrescrever o ambiente do processo.

Saída do `node src/cli.ts`: `0` certo, `1` erro, `2` banco inacessível.

Como funciona:

- Tabela de controle `schema_migrations` (`version`, `name`, `checksum`, `applied_at`), criada no primeiro `up`.
- Cada migration roda numa transação junto com o registro na tabela de controle: ou entra inteira, ou não entra.
- Trava consultiva por banco (`pg_advisory_lock`): uma segunda execução espera a primeira (até 60 s) e depois encontra o banco em dia.
- O `checksum` é o SHA-256 da seção `up`. Se o `up` de uma migration aplicada mudar, `up` e `down` param com erro. Corrigir só o `down` é permitido.
- `status` não altera o banco e sai com `1` se houver migration `alterada` ou `sem-arquivo`.

## Convenção das migrations

Nome: `NNNN_descricao.sql`, com quatro dígitos, minúsculas, números e `_` (`0007_orders.sql`). A numeração é contínua a partir de `0001`, sem salto nem repetição; o comando recusa a pasta fora disso.

Formato do arquivo:

```sql
-- 0007: pedidos.

-- migrate:up
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  total_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down
DROP TABLE orders;
```

Regras:

1. **Uma de cada vez.** Antes de criar, confira o último número da pasta. Nunca há duas migrations sendo escritas em paralelo, e só o papel `banco` as cria.
2. **Aplicada não se edita.** Depois do push, o `up` é imutável; correção vira migration nova.
3. **Todo `up` tem `down`** que devolve o banco ao estado anterior. Os testes fazem `down` de todas e `up` de novo e comparam o esquema.
4. **Sem `BEGIN`/`COMMIT` no arquivo**: a transação é do comando. Por isso `CREATE INDEX CONCURRENTLY` ainda não é aceito; se for preciso, o mecanismo ganha esse suporte antes.
5. **Tipos e nomes**: tabelas em inglês, plural, `snake_case`; chave primária `uuid` com `DEFAULT uuidv7()` (nativa do PostgreSQL 18); datas em `timestamptz`; dinheiro em centavos (`bigint`, sufixo `_cents`); `updated_at` mantido pelo gatilho `set_updated_at()`. Restrições com nome explícito (`<tabela>_<coluna>_<tipo>`), porque o nome aparece nos erros tratados pelo código.

6. **Índices**: nome `<tabela>_<assunto>_idx`; o único leva `_unique` no fim, como as restrições, porque também aparece nos erros (`jobs_unique_key_active_unique`). Índice parcial traz no comentário a consulta que atende, e o código repete o predicado tal como está (`ON CONFLICT (...) WHERE ...` só encontra o índice assim).
7. **Estado em `text` com `CHECK`** (`<tabela>_status_valid`), não `ENUM`: acrescentar um estado é trocar a restrição. Colunas que só valem em certos estados ganham um `CHECK` que as amarra ao estado (`jobs_lock_matches_status`).
8. **`NOTIFY`**: canal `nuva_<assunto>`, emitido por gatilho `AFTER ... FOR EACH ROW` com a condição no `WHEN`, função `<tabela>_notify()` e sem conteúdo (avisos iguais da mesma transação viram um só; quem ouve consulta a tabela). O `down` remove a função.
9. **Sequência avulsa** (que não é de coluna): nome `<assunto>_id_seq`, `AS bigint`, consumida com `nextval`. Serve para numerar em ordem o que não tem tabela, como os eventos do SSE (`user_event_id_seq`). Não volta atrás em `ROLLBACK`: o código que a usa aceita saltos.

### Mudança destrutiva: duas etapas

Remover ou renomear coluna ou tabela, apertar tipo ou restrição: nada disso vai numa migration só, porque o código em produção ainda usa a forma antiga enquanto a nova versão sobe.

1. **Expandir**: uma migration acrescenta a forma nova (coluna, tabela, restrição `NOT VALID`) e copia os dados. O código passa a escrever nas duas e a ler da nova. O `down` desta etapa não perde dado.
2. **Contrair**: numa release seguinte, quando nenhum código usa mais a forma antiga, outra migration a remove.

Exemplo, renomear `users.name` para `display_name`: a `0012` cria `display_name` e copia os valores; o código muda; a `0015` remove `name`.

### Migration sem volta

Quando o `down` não consegue restaurar o que o `up` apagou, a seção `down` leva só a marca:

```sql
-- migrate:down
-- migrate:irreversible
```

O `down` para nela com erro. **Exige aval do humano antes de ser escrita** (specs/002, escalonamento); `down` vazio sem a marca é recusado.

## Banco modelo dos testes

Os testes não aplicam migrations a cada execução: copiam um banco modelo (spec 032).

- Há um modelo por conjunto de migrations: `<db>_tpl_<12 primeiros hex do SHA-256 da pasta migrations/>` (no desenvolvimento, algo como `nuva_edu_tpl_cef8fbd84ee6`). Cada worktree resolve o `@nuva-edu/database` da própria árvore, então prepara e copia o modelo do seu conjunto: dois worktrees com migrations diferentes nunca refazem o modelo um do outro (tarefa 182).
- `ensureTemplate()` cria o modelo do conjunto, aplica as migrations e grava no `COMMENT` do banco o hash completo e o instante do último uso (`nuva-edu migrations sha256:<hash> usado:<ms>`). Na chamada seguinte do mesmo conjunto, não faz nada (só regrava o último uso se ele passou de 10 minutos). O comentário é gravado por último, então um modelo que falhou no meio nunca é dado como pronto (e é apagado). A criação corre sob uma trava consultiva do conjunto (`pg_advisory_lock(774100300, <8 hex do hash>)`): dois processos do mesmo conjunto criam o modelo uma vez; conjuntos diferentes não esperam um pelo outro.
- O modelo fica com `IS_TEMPLATE true` e `ALLOW_CONNECTIONS false`: ninguém conecta nele, e a cópia nunca falha por "banco em uso". Para inspecionar o esquema, crie um banco de teste.
- `createTestDatabase()` faz `CREATE DATABASE <db>_test_<id> TEMPLATE <db>_tpl_<hash>`, com o hash da pasta de quem chama, sob a trava compartilhada do conjunto, e devolve `{ name, config, url, drop }`. O `<id>` é o instante de criação em base 36 mais um sufixo aleatório, único por chamada: dois agentes testam ao mesmo tempo sem se cruzar. Medido no Postgres do compose: cerca de 25 ms.
- `dropStaleTemplates()` expurga os modelos sem uso há mais de 7 dias, guardando sempre os 3 usados por último e o do conjunto de quem chama (`maxAgeMs` e `keep` mudam os padrões). Só apaga um modelo com a trava exclusiva dele livre, então modelo sendo criado ou copiado fica. Modelo sem `COMMENT` pronto e com a trava livre é resto de criação interrompida e sai. O `ensureTemplate()` chama o expurgo sempre que cria um modelo, e o `pnpm db:migrate template` também. O antigo modelo de nome fixo `<db>_tpl` não é tocado.
- `dropStaleTestDatabases()` apaga os `<db>_test_*` criados há mais de 1 hora, restos de execuções interrompidas.

Uso no setup global dos testes:

```ts
import {
  createTestDatabase,
  dropStaleTestDatabases,
  ensureTemplate,
  loadEnvFiles,
} from '@nuva-edu/database';

loadEnvFiles();
await dropStaleTestDatabases();
await ensureTemplate();
const db = await createTestDatabase();
process.env.DATABASE_URL = db.url;
// ... testes ...
await db.drop();
```

O pacote também exporta `migrateUp`, `migrateDown`, `migrationStatus`, `currentVersion(client)` e `latestVersion(dir)`; as APIs comparam os dois últimos para responder `/readyz` (spec 003).

## Desenvolvimento local

```bash
docker compose --env-file .env --env-file .env.local up -d postgres
pnpm db:migrate up
pnpm --filter @nuva-edu/database test        # precisa do Postgres no ar
pnpm --filter @nuva-edu/database typecheck
```

Quem vem do `postgres-data` deve subir pela primeira vez com `pnpm dev:up`, não com o `docker compose up` acima: o Compose sozinho cria o `nuva-edu-postgres-data` vazio, e o script então não copia mais (volume novo já existente não é sobrescrito).

### Volume

Os dados ficam no volume `nuva-edu-postgres-data` (spec 031, "Volumes"). Até a Fase 0 o nome era `postgres-data`: quem ainda o tem não precisa fazer nada à mão, porque o `pnpm dev:up` roda antes o `scripts/volume-migrate.sh`, que para o `postgres`, cria o volume novo e copia o antigo para ele (só quando o novo ainda não existe e o antigo tem o rótulo do projeto `nuva-edu`). No servidor de testes a cópia só acontece com `pnpm deploy:test --migrate-volume`. O volume antigo nunca é apagado pelo script: depois de conferir o banco novo, o humano roda `docker volume rm postgres-data`. Para saber se a cópia ainda falta, sem mudar nada: `bash scripts/volume-migrate.sh --check`.

O código roda direto no Node 26, que executa TypeScript sem build; por isso os imports levam `.ts` e a sintaxe é só a que o Node apaga (sem `enum`, sem propriedades de construtor). Os testes do mecanismo usam `node:test`, bancos `<db>_test_*` próprios e uma base `<db>_selftest_*` para o modelo, sem tocar nos `nuva_edu_tpl_*` de quem estiver testando ao lado.
