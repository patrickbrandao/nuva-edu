# 032 — Verificação e CI

Status: aprovada
Depende de: 001, 002, 031

## Contexto

Vários agentes trabalham ao mesmo tempo, no mesmo diretório, com commit direto na `main`. A verificação precisa ser rápida o bastante para rodar a cada tarefa e completa o bastante para a `main` não quebrar. Por isso há dois níveis: um rápido, que olha só o que mudou, e um completo, que roda tudo.

## Requisitos

- RF-01: `scripts/verify.mjs` implementa os modos `quick` e `full`, expostos como `pnpm verify:quick` e `pnpm verify:full`.
- RF-02: O modo rápido é o padrão durante o desenvolvimento e ao concluir cada tarefa.
- RF-03: O modo completo roda só quando o usuário pedir ("verificação completa", "rode tudo"), antes de release e sempre no CI.
- RF-04: Toda mudança vem com o teste que a cobre. O nível decide quanto da suíte roda, nunca se o teste é escrito.
- RF-05: Ao terminar uma tarefa, o agente informa qual nível rodou e o resultado.
- RF-06: Subagentes seguem a mesma regra: rápido por padrão, completo só quando quem delegou pedir.
- RF-07: Ao fim, o script mostra um resumo com ✓, ✗ ou "pulado" e o tempo de cada passo.
- RF-08: No modo rápido todos os passos rodam e o código de saída é diferente de zero se algum falhar. No completo, a execução para na primeira falha.
- RNF-01: `verify:quick` termina em menos de 60 s para uma mudança em até 10 arquivos de um pacote.
- RNF-02: Recriar o banco de testes a partir do modelo leva menos de 1 s.
- RNF-03: Cobertura mínima de 80% de linhas em `packages/core`, verificada no modo completo; sem meta numérica no restante.
- RNF-04: `verify:full --e2e` termina em menos de 20 minutos no CI.

## Comportamento

### Nível rápido — `pnpm verify:quick`

O que ele considera "mudou" (adaptação ao diretório compartilhado, em que todos trabalham na `main`):

- sem argumentos: arquivos alterados e ainda não commitados (inclusive novos) mais os commits ainda não enviados (`origin/main..HEAD`);
- com `--files <caminhos>`: apenas os caminhos informados, que devem ser os do campo `arquivos` da tarefa. É a forma recomendada quando outros agentes têm alterações pendentes no mesmo diretório;
- num branch que não seja a `main` (contribuição externa): tudo desde `git merge-base HEAD origin/main`.

Passos:

| Passo | Nome no resumo | O que roda |
| --- | --- | --- |
| Lint e formatação | `lint` | Biome só nos arquivos alterados |
| Tipos | `tipos` | `tsc` dos pacotes afetados e dos que dependem deles (grafo do workspace) |
| Postgres local | `postgres` | Prepara o banco de testes; só aparece quando algum passo seguinte precisa dele |
| Testes | `testes` | O arquivo de teste alterado ou o de mesmo nome do arquivo-fonte (`src/x.ts` → `test/x.test.ts`), exceto os de contrato |
| Contrato | `contrato` | Teste de contrato (`test/contract`) da API cujo `openapi.yaml` ou cujas rotas mudaram |
| Cliente gerado | `cliente` | `check` de `packages/api-client` quando um `openapi.yaml` muda, ou quando o próprio gerado (ou o script que o gera) é mexido: o gerado tem de estar em dia com os contratos |
| Banco | `banco` | Testes de banco alterados; migration alterada roda a suíte inteira de `database/postgres` |
| Tipos do banco | `tipos-banco` | `db:types:check` de `packages/core` quando uma migration muda, ou quando os tipos gerados são mexidos: os tipos gerados têm de descrever o banco das migrations |

Não roda build, e2e nem a suíte inteira.

Regras que valem nos dois níveis:

- **Testes de contrato rodam só no passo `contrato`.** Os arquivos de `test/contract` ficam fora do passo `testes`, mesmo quando são eles os alterados, para o resumo dizer onde foi a falha e para o completo não os rodar duas vezes.
- **Gerado não se edita à mão.** O cliente de `packages/api-client` e os tipos do banco de `packages/core` são conferidos contra a fonte (contrato e migrations); divergência é falha do passo `cliente` ou `tipos-banco`, e a correção é regenerar. Durante uma janela de contrato, o `cliente` vermelho é esperado ([002](002-organizacao-do-trabalho.md), "Janela de contrato").

Testes explícitos depois de `--`, para quando a heurística não achar o certo:

```bash
pnpm verify:quick -- test/pedidos.test.ts -t "estorno"
```

```bash
pnpm verify:quick --files apps/classroom-api/src/orders.ts apps/classroom-api/test/orders.test.ts
```

Passo sem nada a fazer aparece como "pulado", não como sucesso.

### Banco de testes no nível rápido

Os testes que dependem de banco rodam contra o Postgres local já no ar (o do ambiente de desenvolvimento), sem subir contêiner a cada vez:

- `NUVA_TEST_DB=local` liga esse modo no setup global dos testes; o `verify:quick` define a variável sozinho.
- Banco modelo `nuva_edu_tpl`: contém todas as migrations aplicadas. O hash da pasta `database/postgres/migrations` fica gravado no `COMMENT` do banco. O modelo só é refeito quando o hash muda.
- Cada execução recria o banco dos testes copiando o modelo (`CREATE DATABASE nuva_edu_test_<id> TEMPLATE nuva_edu_tpl`), então começa limpo em menos de um segundo. O `<id>` é único por execução, para que dois agentes possam testar ao mesmo tempo.
- Ao fim, o banco da execução é apagado; bancos `nuva_edu_test_*` com mais de 1 hora são removidos no início da execução seguinte.
- Se o Postgres local estiver fora do ar, o script tenta subi-lo (`pnpm compose up -d postgres`) e, se não conseguir, mostra esse comando e marca os passos de banco como falha.

### Nível completo — `pnpm verify:full`

Na ordem, parando na primeira falha:

1. `lint`: lint e formatação de todo o repositório (Biome), inclusive os YAML.
2. `tipos`: tipos de todos os pacotes (`tsc`).
3. `tipos-banco`: os tipos gerados do banco conferem com as migrations (`db:types:check`). Vem antes dos testes para nenhum teste rodar contra tipos que não descrevem o banco.
4. `testes`: todos os testes de unidade e integração (Vitest), com o banco isolado por Testcontainers (PostgreSQL 18), e cobertura de `packages/core`. Os testes de contrato ficam de fora. O `test` de `packages/api-client` inclui a conferência do cliente gerado, então no completo não há passo `cliente` separado.
5. `contrato`: testes de contrato das duas APIs contra os `openapi.yaml`, uma única vez. Aqui entra também o `check-contract --no-pending` das duas APIs ([003](003-admin-api.md), "Subida estrita"), quando a tarefa 035 o ligar.
6. `banco`: todos os testes de banco: migrations do zero, `down` de cada migration reversível, e ida e volta da última.
7. `build`: build de todas as aplicações e dos pacotes.
8. `e2e`, com `--e2e`: testes de ponta a ponta (Playwright) contra o ambiente Compose completo, com Mailpit e Mercado Pago simulado.

### Níveis de teste e ferramentas

| Nível | Ferramenta | Onde fica | Cobre |
| --- | --- | --- | --- |
| Unidade | Vitest | `packages/*/test`, `apps/*/test` | Regras de `packages/core` (acesso, vendas, pontos), funções puras |
| Integração | Vitest + Postgres | `apps/*/test` | Rotas, consultas, fila, SSE |
| Contrato | Vitest + validador OpenAPI | `apps/*-api/test/contract` | Toda rota existe no contrato e vice-versa; respostas válidas |
| Banco | Vitest + Postgres | `database/postgres/test` | Migrations, restrições, permissões do `audit_log` |
| Ponta a ponta | Playwright | `e2e/` | Cadastro e login, compra e liberação de acesso, assistir aula, fórum, painel admin, MCP |

Os testes e2e cobrem, no mínimo, os fluxos de medida de sucesso de [000](000-visao-geral.md).

### Qualidade de código

- **Biome**: lint e formatação, uma configuração na raiz. Cobre JavaScript, TypeScript, JSON, CSS e YAML (os `docker-compose.yml`, os `openapi.yaml`, os fluxos do CI); Markdown, o `pnpm-lock.yaml` e as pastas `generated` ficam de fora. YAML mal formatado falha o `lint` como qualquer outro arquivo, nos dois níveis e no gancho de commit. Hoje só o `verify:full` confere YAML; a tarefa 062 leva a mesma cobertura ao `verify:quick` e ao `pre-commit`.
- **`tsc`**: modo estrito; referências de projeto por pacote.
- **lefthook**:
  - `pre-commit`: Biome nos arquivos em stage, YAML inclusive (sem `git add` automático de arquivos alheios), e bloqueio de arquivos proibidos (`.env.local`, dumps).
  - `commit-msg`: valida Conventional Commits em português com a tarefa citada ([002](002-organizacao-do-trabalho.md)).
  - Não roda testes: isso é papel do `verify:quick`.

### CI — GitHub Actions

| Fluxo | Gatilho | O que faz |
| --- | --- | --- |
| `verify` | push na `main` e PR (contribuição externa) | `pnpm verify:full --e2e` |
| `security` | push na `main` e semanal | `pnpm audit`, CodeQL, checagem de licença das dependências (compatíveis com a AGPL-3.0, ver [0016](decisions/0016-licenca-agpl-3.md)) |
| `images` | `verify` verde na `main` | Build `amd64` + `arm64` com o argumento `NUVA_VERSION`, Trivy em cada imagem, push com `sha-<commit>` e `main` |
| `release` | tag `vX.Y.Z` | `verify`, imagens `X.Y.Z`, `X.Y`, `latest` com `NUVA_VERSION=X.Y.Z`, teste de restauração de backup ([033](033-observabilidade-retencao-backup.md)), documentação no GitHub Pages |

- Versão nas imagens: o CI passa `NUVA_VERSION` no build da `admin-api`, da `classroom-api` e do `worker`; é o que o `/api/v1/meta` mostra. Na tag `vX.Y.Z` o valor é `X.Y.Z`; na `main`, a versão do `package.json` da raiz seguida de `-sha-<7 caracteres>` ([031](031-infraestrutura-e-deploy.md), "Publicação de imagens"). Na release, o fluxo confere que a imagem publicada responde a versão da tag.
- Dependabot semanal para npm, Docker e GitHub Actions.
- Segredos no GitHub: apenas o token do Docker Hub. Nenhuma credencial do servidor de testes.
- Se o `verify` da `main` falhar, vale a regra de [002](002-organizacao-do-trabalho.md): correção com prioridade máxima e nenhuma tarefa nova na área afetada.
- Vulnerabilidade alta ou crítica no `pnpm audit` ou no Trivy falha o fluxo.
- Dependência com licença incompatível com a AGPL-3.0 (lista de licenças permitidas versionada na raiz) falha o fluxo `security`.

## Interfaces e contratos

```
pnpm verify:quick [--files <caminhos...>] [-- <argumentos do Vitest>]
pnpm verify:full [--e2e]
```

Códigos de saída: `0` tudo certo; `1` algum passo falhou; `2` ambiente indisponível (por exemplo, Postgres local fora do ar e sem como subir).

Exemplo de resumo:

```
✓ lint         1.2s   (4 arquivos)
✓ tipos        6.8s   (classroom-api, core)
✓ postgres     0.4s
✗ testes       3.1s   (1 de 12 falhou)
– contrato     pulado (sem mudança)
– cliente      pulado (sem mudança)
✓ banco        0.9s
– tipos-banco  pulado (sem mudança)
```

## Dados

- Bancos locais `nuva_edu_tpl` e `nuva_edu_test_<id>`, só no Postgres de desenvolvimento.
- Relatórios de cobertura e de Playwright em `tmp/` (fora do Git); no CI, anexados à execução por 14 dias.

## Critérios de aceite

- [ ] Alterar um arquivo de `packages/core` faz o `verify:quick` checar os tipos de `core` e dos pacotes que dependem dele, e rodar só o teste correspondente.
- [ ] `verify:quick --files` ignora alterações pendentes fora dos caminhos informados.
- [ ] Argumentos depois de `--` chegam ao Vitest.
- [ ] Com um passo falhando, o `verify:quick` ainda roda os demais e sai com código 1.
- [ ] O `verify:full` para no primeiro passo que falhar.
- [ ] Alterar um `openapi.yaml` sem regenerar o cliente falha o passo `cliente`; alterar uma migration sem regenerar os tipos falha o `tipos-banco`.
- [ ] Um teste de `test/contract` alterado roda no passo `contrato`, não no `testes`; no completo, cada teste de contrato roda uma vez.
- [ ] Um `docker-compose.yml` mal formatado falha o `lint` no rápido, no completo e no gancho de commit.
- [ ] A segunda execução seguida do `verify:quick` não refaz o banco modelo; alterar uma migration refaz.
- [ ] Duas execuções simultâneas do `verify:quick` não interferem entre si.
- [ ] Com o Postgres local parado, o `verify:quick` o sobe ou mostra o comando.
- [ ] Cobertura de `packages/core` abaixo de 80% falha o `verify:full`.
- [ ] Commit com mensagem fora do padrão é recusado pelo lefthook.
- [ ] Push na `main` dispara `verify` e, com sucesso, `images`.

## Fora de escopo

- Meta de cobertura fora de `packages/core`.
- Testes de carga no CI (rodam sob pedido, antes da versão 1.0; ver [033](033-observabilidade-retencao-backup.md)).
- Testes de mutação e de regressão visual.
- Ambientes de pré-visualização por PR.

## Decisões relacionadas

- [0014 — Verificação em dois níveis](decisions/0014-verificacao-em-dois-niveis.md)
- [0013 — Commit direto na main, diretório compartilhado (provisória)](decisions/0013-commit-direto-na-main-diretorio-compartilhado.md)
- [0009 — Stack TypeScript, Fastify e Kysely](decisions/0009-stack-typescript-fastify-kysely.md)
