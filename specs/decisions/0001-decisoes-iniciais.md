# 0001 — Decisões iniciais

Status: aceita (S-03, no trecho do servidor dos sites, substituída por [0023](0023-lighttpd-nos-sites.md))
Data: 2026-11-24

## Contexto

A entrevista de início do projeto produziu dezenas de decisões. As de maior impacto ganharam ADR própria (0002 a 0018, ver [HISTORY.md](HISTORY.md)). Esta ADR agrupa as demais, uma por linha, organizadas por fase da entrevista. Os códigos (`F1-03`, `P-01`…) são os usados durante a entrevista e servem de referência cruzada nas specs.

## Decisão

### Dadas pelo usuário antes da entrevista

- U-01: O software se chama `nuva-edu`; repositório público em `github.com/patrickbrandao/nuva-edu`; imagens no Docker Hub em `tmsoftbrasil/nuva-edu-<app>`.
- U-02: Dois sites: `edu-admin.<dominio>` (administração) e `classroom.<dominio>` (alunos). Os nomes DNS são personalizáveis por variável de ambiente (`NUVA_DOMAIN`, `NUVA_ADMIN_HOST`, `NUVA_CLASSROOM_HOST`).
- U-03: Login por Google, Facebook, Apple e e-mail com senha; uma conta de provedor pode também definir senha e usar os dois modos sem conflito. Usuário sem senha não entra com senha vazia.
- U-04: Banco PostgreSQL; proxy reverso Traefik; APIs documentadas em OpenAPI.
- U-05: Desenvolvimento no Docker Desktop local; servidor de testes em `opencode.tmsoft.com.br`, acessado por SSH (usuário e porta ficam no `.env.local`, fora do Git).
- U-06: Comentários de aula são um tópico do fórum; o aluno só participa do fórum das categorias e tópicos de cursos que possui; cadastro é livre, mas sem aquisição só se acessa conteúdo aberto.

### Fase 1 — Produto

- F1-03: Três papéis de equipe além do aluno: `admin`, `manager` (gerente) e `instructor` (instrutor edita só os próprios cursos e modera o fórum deles). Escolhido contra a recomendação de manter só admin e gerente.
- F1-06: Instrutor não recebe repasse financeiro pelo sistema; repasse é combinado fora dele.
- F1-07: Interface só em pt-BR no MVP, com todos os textos em arquivos de tradução; uma moeda por instalação via `NUVA_CURRENCY` (padrão BRL).
- F1-08: Estrutura de conteúdo Curso > Módulo > Aula.
- F1-11: Modos de acesso de um produto: `open` (qualquer cadastrado), `paid` (compra ou plano) e `private` (fora do catálogo, só concessão manual). Aula de curso pago pode ser amostra grátis. Sem acesso, vê-se o programa, não as aulas.
- F1-18: Nota fiscal fora do escopo; o admin exporta as vendas em CSV.
- F1-19: O checkout coleta nome, e-mail e CPF/CNPJ (no primeiro checkout); sem endereço.
- F1-20: Aula concluída por botão manual ou, automaticamente, quando o player informa o fim do vídeo.
- F1-21: Sem provas ou questionários no MVP; certificado com 100% das aulas concluídas. A aula tem campo de tipo para extensão futura.
- F1-22: Mensagem direta só para quem tem acesso ativo (algum produto ou plano) ou é da equipe; inclui bloquear e denunciar.
- F1-23: Pós-moderação: tudo é publicado na hora; qualquer membro denuncia; fila de denúncias no admin; gerente e admin moderam tudo, instrutor modera o fórum dos próprios cursos.
- F1-24: Porte-alvo: 10.000 cadastrados, 500 simultâneos, 2 vCPU e 4 GB de RAM, p95 da API abaixo de 300 ms, nó único.
- F1-25: Gerente modera, responde chamados, suspende alunos, edita qualquer conteúdo e evento, publica novidades, concede e revoga acesso manual e vê vendas. Só o admin: preços, planos, cupons, reembolso, configurações, integrações, equipe e exclusão definitiva.
- F1-26: LGPD: aceite versionado de termos e política; exportação dos próprios dados (JSON) e exclusão de conta pelo perfil; a exclusão anonimiza e mantém os registros de venda pelo prazo fiscal.
- P-01: O acesso é um direito derivado em cascata: pacote libera seus cursos e ebooks; curso libera os ebooks vinculados a ele e às suas aulas. Revogação (reembolso, fim de plano) desfaz a cascata, salvo se outro direito ainda cobrir o item.
- P-03: Fórum: categoria automática por curso e tópico automático por aula (comentar na aula é responder ao tópico). Categorias livres são criadas pela equipe, cada uma com público "todos os cadastrados" ou "quem tem acesso ativo". O aluno cria tópicos, não categorias. Fórum de curso aberto é de todos os cadastrados.
- P-04: Web responsiva, celular incluso, sem app nativo; WCAG 2.1 AA nos fluxos principais.
- P-05: Gamificação com tabela de pontos e níveis configurável pelo admin, com padrão de fábrica; medalhas manuais e automáticas (pontos, conclusão de curso); ranking semanal e geral.
- P-06: Evento do calendário: link externo de transmissão, público por evento (todos, acesso ativo ou produto específico) e gravação apontando para uma aula.
- P-07: Certificado em PDF com código e página pública de validação.
- P-08: Medidas de sucesso: instalação nova no ar em até 15 minutos com `docker compose`; do cadastro à primeira aula comprada em até 3 minutos; p95 abaixo de 300 ms com 500 simultâneos.

### Fase 2 — Arquitetura

- F2-11: E-mail por SMTP configurável via variáveis de ambiente, enviado pela fila com novas tentativas; Mailpit captura os e-mails no desenvolvimento.
- A-04: Contratos: `apps/admin-api/openapi.yaml` e `apps/classroom-api/openapi.yaml` (OpenAPI 3.1; o fluxo SSE é descrito no OpenAPI). Ferramentas do MCP documentadas em spec própria. Sem AsyncAPI e sem API pública para terceiros além do MCP.
- A-05: Falhas externas: provedor de login fora, os demais métodos seguem; SMTP fora, a fila tenta de novo; link de vídeo ou ebook quebrado, o aluno vê um aviso e um botão "reportar" que abre chamado.

### Fase 3 — Stack e infraestrutura

- F3-08: Documentação em `./docs`, publicada com VitePress no GitHub Pages a cada release; a referência das APIs é renderizada dos `openapi.yaml`.
- S-03: Imagens multi-plataforma `linux/amd64` e `linux/arm64`; os sites são servidos por Nginx sem privilégios.
- S-04: Desenvolvimento no Docker Desktop: `edu-admin.localhost` e `classroom.localhost` pelo Traefik próprio na porta 8080 (HTTP), Mailpit para e-mail e Postgres em porta acima de 1024.
- S-05: Produção suportada: Docker Compose em Linux (amd64 e arm64), nó único. Kubernetes fora de escopo.
- S-06: Git: repositório público no GitHub, branch principal `main`.

### Fase 4 — Qualidade e operação

- F4-02: Biome para lint e formatação, `tsc` para tipos e lefthook no pre-commit (arquivos alterados e validação da mensagem de commit).
- F4-03: GitHub Actions roda `verify:full --e2e` na `main` (e em PRs de contribuição externa). A `main` publica imagens com a etiqueta do commit; a tag `vX.Y.Z` publica a versão, `latest` e a documentação. O deploy no servidor de testes é o comando local `pnpm deploy:test`, via SSH do usuário; nenhuma chave do servidor fica no GitHub.
- F4-04: Contêiner `backup` em perfil opcional: `pg_dump` diário, retenção de 7 diários e 4 semanais, script de restauração; o CI restaura um dump a cada release. A cópia para fora do servidor é documentada e fica a cargo de quem instala.
- F4-05: Observabilidade: logs JSON na saída padrão com identificador de requisição (sem senha, token ou CPF); `/healthz` e `/readyz` por serviço; `/metrics` no formato Prometheus só na rede interna; tela no admin com fila, e-mails e webhooks com falha. Sem tracing e sem alertas embutidos.
- F4-06: Retenção, ajustável por `NUVA_RETENTION_*` e expurgada diariamente pelo worker: sessão 30 dias sem uso; links de confirmação e redefinição 24 h; tarefas concluídas 7 dias, com falha 30 dias; notificações lidas 90 dias; auditoria 2 anos; webhooks recebidos 90 dias; logs de contêiner 10 MB x 5 arquivos.
- Q-01: Ambientes `dev` (Docker Desktop) e `teste` (servidor opencode), com o mesmo compose e as mesmas imagens; produção é a instalação de cada escola, guiada por `docs/`. Mercado Pago em modo de teste nos dois.
- Q-02: Configuração por variáveis de ambiente; `./.env` versionado só com valores não secretos; segredos sem valor padrão (`${VAR:?}`) vindos de `.env.local`, fora do Git; `.env.example` documenta todas. Fora do Git: `.env.local`, `tasks/`, `tmp/`, `node_modules/`, `dist/`, cobertura e dumps de backup.
- Q-03: Segurança: `pnpm audit`, Dependabot, CodeQL e Trivy nas imagens. Ameaças principais, cada uma com mitigação e teste na spec: vazamento do banco expõe senhas em texto; tomada de conta por força bruta ou vínculo social indevido; webhook de pagamento forjado; elevação de privilégio entre papéis ou por chave MCP; XSS em conteúdo de aluno; acesso a aula ou ebook sem direito.
- Q-04: SemVer com tags `vX.Y.Z`; `CHANGELOG.md` no formato Keep a Changelog, atualizado em cada entrega. APIs sob `/api/v1`; mudança incompatível só em `/api/v2`, mantendo a v1 por uma versão menor.
- Q-05: Migrations sempre versionadas, com `down` quando possível; mudança destrutiva em duas etapas (expandir, depois contrair), para permitir voltar à imagem anterior.

### Fase 5 — Organização do trabalho

- F5-01: Ferramentas de agente: Claude Code e OpenCode. Geram-se `AGENTS.md`, `CLAUDE.md` (só `@AGENTS.md`), `.claude/agents/<papel>.md` e `.opencode/agent/<papel>.md`.
- F5-02: Dez papéis com pastas sem sobreposição: arquiteto (`specs/`, ADRs, `openapi.yaml`, PLAN), banco (`database/postgres/`), nucleo (`packages/core`), api-admin (`apps/admin-api`, MCP), api-classroom (`apps/classroom-api`, `apps/worker`), web-admin (`apps/admin`), web-classroom (`apps/classroom`), interface (`packages/ui`, `packages/api-client`), infra (Docker, CI, `scripts/`, `docs/`) e testador (`e2e/`).
- F5-05: Só o arquiteto altera `specs/`, ADRs e `openapi.yaml`; só o papel banco cria migrations. Implementador que precisar de mudança abre tarefa. Contrato e migration são sempre sequenciais.
- O-04: Tarefas rodam em paralelo quando os campos `arquivos` não se cruzam. Dentro de cada recurso a ordem é fixa: spec e contrato, migration, núcleo, APIs, sites, e2e.
- O-05: Conventional Commits em português, citando a tarefa: `feat(api-admin): ... (task 012)`.
- O-06: Definition of Done: código implementado; testes do nível acordado escritos e passando; lint, formatação e tipos limpos; spec e contratos atualizados se mudaram (via arquiteto); `docs/` atualizado quando aplicável; `CHANGELOG.md` com resumo compacto; arquivo da tarefa removido; `verify:quick` verde e nível de verificação informado no relato final.
- O-07: Escalonar ao humano: conflito entre spec e pedido; decisão irreversível ou destrutiva; mudança de contrato já publicado em release; qualquer coisa que toque a regra da senha em texto; credencial ou gasto externo (Mercado Pago, provedores de login, Docker Hub, DNS); ação no servidor de testes além do `deploy:test`; tarefa que falhou em mais de uma tentativa de correção; necessidade de alterar arquivo de outro papel.

Nota (2026-11-24): os itens F5-03, O-01, O-02 e O-03 da entrevista (commit direto na `main`, regras do diretório compartilhado, base do `verify:quick` e push após o commit), registrados na [0013](0013-commit-direto-na-main-diretorio-compartilhado.md), foram substituídos pela [0021](0021-worktree-por-tarefa.md). O F5-04 (sem PR e sem agente revisor) segue valendo.

## Alternativas consideradas

Para cada item, as alternativas foram apresentadas na entrevista e descartadas pelo usuário. As mais relevantes:

- F1-03: só admin e gerente, com instrutor como campo de texto (recomendada; descartada porque há professores externos).
- F1-06: relatório de vendas por instrutor; repasse automático (split).
- F1-07: três idiomas já no MVP; textos fixos no código.
- F1-20: só botão manual; percentual assistido (inviável com players externos que não informam o tempo).
- F1-22: qualquer cadastrado; só aluno com equipe.
- F1-23: aprovação prévia só para cases; aprovação prévia para tudo.
- F1-24: 1.000 alunos e 100 simultâneos; 100.000 alunos e 5.000 simultâneos.
- F1-25: gerente só com moderação e suporte; gerente com tudo menos equipe e configuração.
- F1-26: exportação e exclusão só pelo admin, a pedido.
- F2-11: API de um provedor de e-mail específico.
- F3-08: só Markdown no repositório.
- F4-02: ESLint com Prettier.
- F4-03: deploy automático na `main` (exigiria chave de root de um servidor compartilhado no GitHub).
- F4-04: só scripts e documentação; backup com envio para S3.
- F4-05: só logs e saúde; OpenTelemetry completo.
- F5-02: cinco papéis amplos.
- F5-05: implementador propõe spec, contrato e migration no próprio trabalho.

## Consequências

- As specs referenciam estes códigos em "Decisões relacionadas" quando não houver ADR própria.
- Qualquer item aqui só é reaberto com fato novo, por meio de uma ADR nova que o substitua; esta ADR recebe então uma nota no item indicando a substituta.
- Itens com número (porte, retenção, carência, bloqueio de login) viram requisitos não funcionais verificáveis nas specs correspondentes.
