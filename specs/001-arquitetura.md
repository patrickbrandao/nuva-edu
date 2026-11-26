# 001 — Arquitetura

Status: aprovada
Depende de: 000

## Contexto

Define os componentes do nuva-edu, quem é dono de cada dado, as integrações, a autenticação e os contratos. Resume também a stack e as regras de qualidade e operação, com ponteiros para as specs e ADRs que as detalham.

## Requisitos

- RF-01: Duas APIs HTTP independentes (`admin-api` e `classroom-api`) sobre um único PostgreSQL.
- RF-02: Toda regra de acesso e de negócio vive uma única vez, em `packages/core`, usada pelas duas APIs e pelo worker.
- RF-03: Cada tabela tem um único componente que escreve nela (tabela "Dados").
- RF-04: Nenhum componente depende de Redis, mensageria ou armazenamento de objetos.
- RNF-01: Uma instalação completa roda em um nó com 2 vCPU e 4 GB de RAM.
- RNF-02: Falha de qualquer integração externa não derruba login por outro método, navegação nem aulas.

## Comportamento

### Componentes

| Componente | Imagem | Responsabilidade | Spec |
| --- | --- | --- | --- |
| `admin-api` | `tmsoftbrasil/nuva-edu-admin-api` | API administrativa, servidor MCP e SSE das notificações da equipe | [003](003-admin-api.md), [027](027-mcp.md) |
| `classroom-api` | `tmsoftbrasil/nuva-edu-classroom-api` | API do aluno, vitrine, checkout, webhook de pagamento, SSE | [004](004-classroom-api.md) |
| `worker` | `tmsoftbrasil/nuva-edu-worker` | Fila, e-mails, reconciliação, vencimentos, certificados, expurgo | [005](005-worker-e-fila.md) |
| `admin` | `tmsoftbrasil/nuva-edu-admin` | Site estático de administração, servido por lighttpd ([0023](decisions/0023-lighttpd-nos-sites.md)) | [006](006-sites-e-interface.md) |
| `classroom` | `tmsoftbrasil/nuva-edu-classroom` | Site estático do aluno, servido por lighttpd ([0023](decisions/0023-lighttpd-nos-sites.md)) | [006](006-sites-e-interface.md) |
| `postgres` | `postgres:18` | Único armazenamento persistente | [031](031-infraestrutura-e-deploy.md) |
| `traefik` | `traefik` | Proxy reverso e TLS (perfil opcional) | [031](031-infraestrutura-e-deploy.md) |
| `backup` | — | `pg_dump` diário (perfil opcional) | [033](033-observabilidade-retencao-backup.md) |
| `mailpit` | — | Captura de e-mail, só em desenvolvimento | [031](031-infraestrutura-e-deploy.md) |

### Roteamento

| Endereço | Destino |
| --- | --- |
| `https://<NUVA_ADMIN_HOST>/` | site `admin` |
| `https://<NUVA_ADMIN_HOST>/api/v1/...` | `admin-api` |
| `https://<NUVA_ADMIN_HOST>/mcp` | `admin-api` (MCP) |
| `https://<NUVA_CLASSROOM_HOST>/` | site `classroom` |
| `https://<NUVA_CLASSROOM_HOST>/api/v1/...` | `classroom-api` |

Cada site chama só a API do próprio endereço: não há CORS, e o cookie de sessão de um site não vale no outro.

### Código compartilhado

| Pacote | Conteúdo | Usado por |
| --- | --- | --- |
| `packages/core` | Entidades, regras de acesso, direitos em cascata, acesso a dados (Kysely), fila | APIs e worker |
| `packages/api-kit` | Base HTTP comum do Fastify: validação pelo contrato, problem+json, id de requisição, IP real, sessão e CSRF | APIs |
| `packages/ui` | Componentes e tokens vindos do minui-react | Sites |
| `packages/api-client` | Clientes e tipos gerados dos `openapi.yaml` | Sites e testes |

### Integrações externas e falhas

| Integração | Uso | Quando falha |
| --- | --- | --- |
| Mercado Pago | Checkout, assinatura, estorno | Pedido fica "aguardando pagamento"; o worker reconcilia; o checkout mostra aviso e o resto do site segue ([013](013-pagamentos-mercado-pago.md)). |
| Google, Facebook, Apple | Login social | O método afetado mostra erro; os demais seguem ([007](007-contas-e-autenticacao.md)). |
| SMTP | E-mail transacional | A fila tenta de novo; o admin vê os pendentes ([024](024-notificacoes-e-email.md)). |
| Links de vídeo e arquivo | Conteúdo das aulas e ebooks | O aluno vê aviso e o botão "reportar", que abre chamado ([023](023-chamados-de-suporte.md)). |

### Tempo real

SSE em `GET /api/v1/stream` das duas APIs, alimentado por `LISTEN/NOTIFY` do PostgreSQL e pela mesma base de eventos. A `classroom-api` serve mensagens diretas, comunidade e notificações; a `admin-api` serve as notificações da equipe. O envio é sempre por HTTP comum, e cada host autentica a própria sessão.

### Autenticação e autorização

- Cadastro único de usuários com papel (`student`, `instructor`, `manager`, `admin`).
- Sessão por cookie httpOnly e Secure com identificador opaco; sessões em tabela.
- O site admin recusa quem é só `student`.
- Admin inicial criado de `ADMIN_EMAIL` e `ADMIN_PASSWORD` na primeira subida.
- MCP autenticado por chave no cabeçalho; a chave age com o papel atual de quem a emitiu.
- Detalhes em [007](007-contas-e-autenticacao.md), [008](008-papeis-e-permissoes.md) e [027](027-mcp.md).

## Interfaces e contratos

- `apps/admin-api/openapi.yaml` e `apps/classroom-api/openapi.yaml`, em OpenAPI 3.1, escritos à mão e anteriores ao código. Os fluxos SSE são descritos nos contratos das duas APIs.
- As ferramentas do MCP são descritas em [027](027-mcp.md).
- Não há sistema de eventos, portanto não há AsyncAPI.
- Não há API pública para terceiros além do MCP.
- No contrato, o servidor é a origem do site (`/`) e cada caminho aparece completo, igual à rota registrada: as rotas de negócio sob `/api/v1`, e `/healthz` e `/readyz` na raiz, fora do prefixo. `/metrics` não entra no contrato ([033](033-observabilidade-retencao-backup.md)).
- Os componentes comuns (erro `Problem`, paginação `Page`/`Limit`/`Cursor`, `Uuid`, `DateTime`, `Date`, `MoneyCents`, `Meta`, saúde e as respostas de erro) têm o mesmo nome e formato nos dois contratos; mudança em um é feita nos dois.
- Versão das APIs no caminho (`/api/v1`). Mudança incompatível só em `/api/v2`, mantendo a v1 por uma versão menor.

## Dados

Um único banco PostgreSQL 18. Migrations em `database/postgres/migrations/`. Quem escreve em cada grupo de tabelas:

| Dono (escreve) | Dados |
| --- | --- |
| `admin-api` | Configuração da escola, equipe, catálogo (cursos, módulos, aulas, ebooks, pacotes), planos, cupons, eventos, novidades, concessões manuais, ações de moderação, chaves MCP, auditoria. |
| `classroom-api` | Cadastro e sessões, cesta e pedidos, progresso, anotações, fórum, perfil, mensagens, cases, chamados (lado do aluno), leitura de notificações. |
| `worker` | Estado de pagamento e assinatura, direitos de acesso derivados, pontos e medalhas automáticas, certificados, fila de e-mail, expurgo. |

Os demais componentes só leem. Uma escrita cruzada é feita enfileirando uma tarefa para o dono, nunca diretamente.

Imagens enviadas (avatar, capas, galeria de cases) ficam no próprio banco ([029](029-imagens.md)).

## Stack

| Camada | Escolha |
| --- | --- |
| Linguagem | TypeScript em Node 26 LTS |
| API | Fastify, contrato primeiro |
| Banco | PostgreSQL 18, Kysely, migrations em SQL puro |
| Sites | React 19, Vite, Tailwind 4, React Router, TanStack Query |
| MCP | SDK oficial em TypeScript, transporte Streamable HTTP |
| E-mail | Nodemailer sobre SMTP |
| Monorepo | pnpm workspaces (`apps/`, `packages/`) |
| Imagens Docker | `linux/amd64` e `linux/arm64` |
| Produção suportada | Docker Compose em Linux, nó único |

## Qualidade e operação

| Tema | Regra | Spec |
| --- | --- | --- |
| Verificação | `pnpm verify:quick` por padrão; `pnpm verify:full` sob pedido e no CI | [032](032-verificacao-e-ci.md) |
| Código | Biome, `tsc`, lefthook | [032](032-verificacao-e-ci.md) |
| CI/CD | GitHub Actions; deploy de teste por `pnpm deploy:test` | [032](032-verificacao-e-ci.md), [031](031-infraestrutura-e-deploy.md) |
| Ambientes | `dev` (Docker Desktop) e `teste` (servidor opencode) | [031](031-infraestrutura-e-deploy.md) |
| Segredos | Variáveis de ambiente; nada secreto no Git | [031](031-infraestrutura-e-deploy.md) |
| Observabilidade, retenção, backup, ameaças | Logs JSON, saúde, métricas, expurgo diário, `pg_dump` | [033](033-observabilidade-retencao-backup.md) |
| Versões | SemVer, Keep a Changelog, migrations em duas etapas quando destrutivas | [032](032-verificacao-e-ci.md) |

## Critérios de aceite

- [ ] Os cinco serviços sobem com um único `docker compose up` e respondem às verificações de saúde.
- [ ] Nenhum componente escreve em tabela de que não é dono (verificado por revisão das permissões do banco ou por teste).
- [ ] Um teste de contrato falha quando uma rota diverge do `openapi.yaml`.

## Fora de escopo

- Vários nós, réplicas de API, cache dedicado, mensageria.
- Kubernetes.

## Decisões relacionadas

- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
- [0008 — Fila e SSE no PostgreSQL](decisions/0008-fila-e-sse-no-postgres.md)
- [0028 — SSE também na admin-api](decisions/0028-sse-tambem-na-admin-api.md)
- [0007 — Imagens no PostgreSQL](decisions/0007-imagens-no-postgres.md)
- [0009 — Stack TypeScript, Fastify, Kysely](decisions/0009-stack-typescript-fastify-kysely.md)
- [0010 — Interface: minui em packages/ui](decisions/0010-interface-minui-em-packages-ui.md)
- [0011 — Autenticação, sessão e vínculo social](decisions/0011-autenticacao-sessao-e-vinculo-social.md)
- [0012 — MCP: chaves herdam o papel](decisions/0012-mcp-chaves-herdam-papel.md)
- [0015 — Traefik próprio opcional](decisions/0015-traefik-proprio-opcional.md)
- [0018 — Vitrine como SPA](decisions/0018-vitrine-spa.md)
- [0023 — lighttpd como servidor de arquivos dos sites](decisions/0023-lighttpd-nos-sites.md)
