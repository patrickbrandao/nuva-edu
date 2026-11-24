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

- `ensureTemplate()` cria `<db>_tpl` (no desenvolvimento, `nuva_edu_tpl`), aplica as migrations e grava no `COMMENT` do banco o SHA-256 da pasta `migrations/`. Na chamada seguinte, se o hash for o mesmo, não faz nada; se mudou, apaga e refaz. O comentário é gravado por último, então um modelo que falhou no meio nunca é dado como pronto (e é apagado).
- O modelo fica com `IS_TEMPLATE true` e `ALLOW_CONNECTIONS false`: ninguém conecta nele, e a cópia nunca falha por "banco em uso". Para inspecionar o esquema, crie um banco de teste.
- `createTestDatabase()` faz `CREATE DATABASE <db>_test_<id> TEMPLATE <db>_tpl` e devolve `{ name, config, url, drop }`. O `<id>` é o instante de criação em base 36 mais um sufixo aleatório, único por chamada: dois agentes testam ao mesmo tempo sem se cruzar. Medido no Postgres do compose: cerca de 25 ms.
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

O código roda direto no Node 26, que executa TypeScript sem build; por isso os imports levam `.ts` e a sintaxe é só a que o Node apaga (sem `enum`, sem propriedades de construtor). Os testes do mecanismo usam `node:test`, bancos `<db>_test_*` próprios e uma base `<db>_selftest_*` para o modelo, sem tocar no `nuva_edu_tpl` de quem estiver testando ao lado.
