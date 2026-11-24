# 002 — Organização do trabalho

Status: aprovada
Depende de: 000, 001

## Contexto

Vários agentes (Claude Code e OpenCode) trabalham no mesmo repositório, no mesmo diretório e direto na `main`, coordenados por uma pessoa. Esta spec define quem pode mexer em quê e como o trabalho flui sem conflito.

## Requisitos

- RF-01: Cada papel altera apenas as próprias pastas.
- RF-02: Cada tarefa lista os arquivos que pode alterar; duas tarefas em andamento nunca compartilham arquivo.
- RF-03: Toda mudança de comportamento começa pela spec; contrato e migration vêm antes do código que os usa.
- RF-04: Toda mudança vem com o teste que a cobre.
- RNF-01: Nenhum commit contém arquivo fora das pastas do papel de quem o fez (verificável pelo histórico).

## Comportamento

### Papéis

| Papel | Responsabilidade | Pastas de propriedade |
| --- | --- | --- |
| `arquiteto` | Specs, ADRs, contratos, plano e criação de tarefas | `specs/`, `apps/*/openapi.yaml`, `AGENTS.md`, `CLAUDE.md`, `.claude/agents/`, `.opencode/agent/` |
| `banco` | Esquema, migrations, sementes de teste | `database/postgres/` |
| `nucleo` | Regras de negócio, acesso a dados, fila | `packages/core/` |
| `api-admin` | API administrativa e MCP | `apps/admin-api/` (exceto `openapi.yaml`) |
| `api-classroom` | API do aluno e worker | `apps/classroom-api/` (exceto `openapi.yaml`), `apps/worker/` |
| `web-admin` | Site de administração | `apps/admin/` |
| `web-classroom` | Site do aluno | `apps/classroom/` |
| `interface` | Componentes, tokens e cliente gerado das APIs | `packages/ui/`, `packages/api-client/` |
| `infra` | Docker, proxy, CI, scripts, documentação, arquivos da raiz | `docker-compose.yml`, `.env`, `.env.example`, `proxy/`, `.github/`, `scripts/`, `docs/`, `package.json`, `pnpm-workspace.yaml`, configurações da raiz, `apps/*/Dockerfile`, `apps/*/docker-compose.yml` |
| `testador` | Testes de ponta a ponta | `e2e/` |

Regras de propriedade:

- Só o `arquiteto` altera `specs/`, as ADRs e os `openapi.yaml`.
- Só o `banco` cria ou altera migrations. As migrations são numeradas em sequência e criadas uma de cada vez.
- Quem precisar de mudança em spec, contrato ou migration cria uma tarefa para o dono e segue em outra tarefa.
- O `CHANGELOG.md` é alterado por qualquer papel, só acrescentando linhas em `## [Não lançado]`.
- Testes de unidade e de integração ficam junto do código e pertencem ao dono da pasta.

### Git

- Um único branch: `main`. Não há PR nem branch de tarefa.
- Todos os agentes trabalham no mesmo diretório.
- Mensagens no padrão Conventional Commits, em português, citando a tarefa: `feat(api-admin): lista de usuários com filtro (task 012)`.
- O escopo do commit é o nome do papel ou do pacote.
- Depois do commit da entrega: `git push origin main`.
- O usuário revisa os commits depois. Não há agente revisor.

### Regras do diretório compartilhado

Como todos editam o mesmo checkout, cada agente:

1. Altera só os arquivos listados na tarefa e dentro das pastas do seu papel.
2. Faz `git add` e `git commit` citando os caminhos. Nunca usa `git add -A`, `git add .` nem `git commit -a`.
3. Nunca usa `stash`, `reset`, `checkout`, `restore`, `clean` ou `rebase` de forma que afete arquivos que não são seus.
4. Não troca de branch e não reescreve histórico.
5. Ignora alterações não commitadas de outros agentes: não as corrige, não as commita, não as desfaz.
6. Se encontrar um arquivo seu alterado por outro, para e escala ao humano.

### Fluxo das tarefas

A fila fica em `tasks/`, fora do Git, no formato do template de tarefa.

1. Um problema encontrado por inspeção vira uma tarefa nova (qualquer papel pode criar; o `arquiteto` cria as de cada fase do plano).
2. O agente pega uma tarefa `aberta`, do seu papel, cujas dependências já foram removidas da fila.
3. Antes de começar, muda o status para `em-andamento` e preenche `responsavel`. Ninguém pega tarefa `em-andamento`.
4. Ao concluir, atende a Definition of Done, remove o arquivo da tarefa e faz o commit citando o ID.
5. Tarefa descartada também é removida; se o descarte for uma decisão, o `arquiteto` registra uma ADR.
6. Tarefa que não pode avançar fica `bloqueada`, com o motivo escrito no corpo.

O status `em-revisao` do template não é usado, porque não há revisão antes da `main`.

### Paralelismo

- Duas tarefas rodam em paralelo quando os campos `arquivos` não se cruzam.
- Dentro de um recurso a ordem é fixa: spec e contrato → migration → `packages/core` → APIs → `packages/api-client` → sites → e2e.
- Mudança de contrato e migration são sempre sequenciais entre si.
- As frentes paralelas de cada fase estão no [PLAN](PLAN.md).

### Verificação

- Padrão: `pnpm verify:quick`, ao concluir cada tarefa. Com `--files <caminhos>` limita-se aos arquivos da tarefa.
- `pnpm verify:full` só quando o usuário pedir e antes de release. O CI roda o nível completo com e2e na `main` a cada push.
- Ao terminar, o agente diz qual nível rodou e o resultado.
- Se o CI da `main` quebrar, a correção vira tarefa de prioridade máxima para o dono do arquivo, e ninguém inicia tarefa nova naquela área até resolver.
- Detalhes em [032](032-verificacao-e-ci.md).

### Definition of Done

Uma tarefa está concluída quando tudo abaixo é verdade:

- o código está implementado;
- os testes do nível acordado foram escritos e estão passando;
- lint, formatação e checagem de tipos estão limpos;
- `pnpm verify:quick` está verde, e o nível rodado foi informado no relato final;
- a spec e os contratos estão atualizados, se mudaram (pelo `arquiteto`);
- a documentação em `docs/` está atualizada, quando aplicável;
- o `CHANGELOG.md` recebeu o resumo compactado da entrega;
- o arquivo da tarefa foi removido;
- o commit cita o ID da tarefa e foi enviado à `main`.

### Escalonamento ao humano

O agente para e pergunta quando houver:

- conflito entre a spec e o que foi pedido, ou entre duas specs;
- decisão irreversível ou destrutiva: apagar dados, migration sem volta, reescrever histórico;
- mudança em contrato já publicado em uma release;
- qualquer coisa que toque a regra da senha em texto legível ([0002](decisions/0002-senha-em-texto-legivel.md));
- necessidade de credencial ou gasto externo: Mercado Pago, provedores de login, Docker Hub, DNS, SMTP;
- ação no servidor de testes além do `pnpm deploy:test`;
- tarefa que falhou em mais de uma tentativa de correção;
- necessidade de alterar arquivo de outro papel, ou arquivo próprio alterado por outro agente.

## Interfaces e contratos

- Template de tarefa, de spec e de ADR: os definidos no roteiro do projeto e usados nos arquivos existentes.
- Definições de papel para as ferramentas: `.claude/agents/<papel>.md` e `.opencode/agent/<papel>.md`.

## Dados

- `tasks/` e `tmp/` ficam fora do Git. O histórico do Git preserva o registro das tarefas concluídas pelo ID no commit.

## Critérios de aceite

- [ ] Existe uma definição por papel nas duas ferramentas.
- [ ] Todo commit de entrega cita uma tarefa.
- [ ] Nenhum commit mistura pastas de papéis diferentes, salvo `CHANGELOG.md`.

## Fora de escopo

- Pull requests internos, worktrees e agente revisor.

## Decisões relacionadas

- [0013 — Commit direto na main, diretório compartilhado](decisions/0013-commit-direto-na-main-diretorio-compartilhado.md)
- [0014 — Verificação em dois níveis](decisions/0014-verificacao-em-dois-niveis.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
