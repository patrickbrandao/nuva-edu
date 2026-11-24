# Registro de decisões (ADRs)

Índice de `specs/decisions/`. Toda ADR criada ou substituída é registrada aqui.

Antes de propor mudança de stack, arquitetura ou processo, consulte esta lista. Uma decisão aceita só é reaberta diante de fato novo, por uma ADR nova que substitui a anterior; a anterior recebe o status "substituída por nnnn".

| Arquivo | Título | Status | O que contém |
| --- | --- | --- | --- |
| [0001-decisoes-iniciais.md](0001-decisoes-iniciais.md) | Decisões iniciais | aceita | Decisões menores da entrevista, uma por linha e por fase: nome e domínios, papéis, idioma e moeda, estrutura do conteúdo, modos de acesso, cascata de direitos, regras do fórum, moderação, porte-alvo, poderes do gerente, LGPD, e-mail, contratos, falhas externas, documentação, imagens Docker, ambientes, segredos, ameaças, versionamento, migrations, backup, observabilidade, retenção, ferramentas e papéis de agente, propriedade de specs, paralelismo, commits, Definition of Done e escalonamento |
| [0002-senha-em-texto-legivel.md](0002-senha-em-texto-legivel.md) | Senha em texto legível | aceita (inquestionável; não reabrir) | Senha gravada em texto, quem pode vê-la e onde nunca aparece, mitigações do login, ausência de segunda etapa e riscos aceitos |
| [0003-instalavel-single-tenant.md](0003-instalavel-single-tenant.md) | Software instalável, uma escola por instalação | aceita | Single-tenant instalável; multi-tenant fora de escopo |
| [0004-duas-apis-um-banco.md](0004-duas-apis-um-banco.md) | Duas APIs sobre um único banco | aceita | `admin-api`, `classroom-api` e `worker`; biblioteca de domínio compartilhada; migrations únicas; dono de cada dado |
| [0005-modelo-de-venda-e-mercado-pago.md](0005-modelo-de-venda-e-mercado-pago.md) | Modelo de venda e Mercado Pago | aceita | Compra avulsa e assinatura, planos, cesta, provedor plugável com Mercado Pago, cupons, reembolso, webhook, reconciliação e carência |
| [0006-conteudo-por-link-externo.md](0006-conteudo-por-link-externo.md) | Conteúdo por link externo | aceita | Vídeos, ebooks e arquivos só por link; sem armazenamento próprio; risco de repasse do link |
| [0007-imagens-no-postgres.md](0007-imagens-no-postgres.md) | Imagens enviadas ficam no PostgreSQL | provisória (banco acima de 20 GB ou backup acima de 30 minutos) | Avatar, capas e galeria de cases gravados no banco, com limites |
| [0008-fila-e-sse-no-postgres.md](0008-fila-e-sse-no-postgres.md) | Fila de tarefas e tempo real no PostgreSQL | provisória (mais de um nó ou p95 acima de 300 ms por causa da fila) | SSE com `LISTEN/NOTIFY`, fila em tabela com `worker`; sem Redis, cache nem mensageria |
| [0009-stack-typescript-fastify-kysely.md](0009-stack-typescript-fastify-kysely.md) | Stack: TypeScript, Fastify com contrato primeiro, Kysely | aceita | Node 26, contrato OpenAPI primeiro, PostgreSQL 18, migrations SQL, monorepo pnpm e bibliotecas |
| [0010-interface-minui-em-packages-ui.md](0010-interface-minui-em-packages-ui.md) | Interface: componentes do minui-react em packages/ui | aceita | Cópia dos componentes do minui-react para um pacote interno; sites em React 19, Vite e Tailwind 4 |
| [0011-autenticacao-sessao-e-vinculo-social.md](0011-autenticacao-sessao-e-vinculo-social.md) | Autenticação: sessão por cookie, cadastro único e vínculo social | aceita | Sessão no banco, papéis em cadastro único, admin inicial, união de contas por e-mail verificado, proteção de login sem segunda etapa |
| [0012-mcp-chaves-herdam-papel.md](0012-mcp-chaves-herdam-papel.md) | MCP: chaves herdam o papel do emissor | aceita | MCP na `admin-api`, chaves com hash, permissão pelo papel atual do emissor, auditoria imutável |
| [0013-commit-direto-na-main-diretorio-compartilhado.md](0013-commit-direto-na-main-diretorio-compartilhado.md) | Commit direto na main, em diretório compartilhado | provisória (commit com arquivo de outro papel ou main quebrada por trabalho misturado) | Sem PR, sem worktree e sem revisor; regras do diretório compartilhado; push e CI quebrado |
| [0014-verificacao-em-dois-niveis.md](0014-verificacao-em-dois-niveis.md) | Verificação em dois níveis | aceita | `verify:quick` e `verify:full`, ferramentas de teste, cobertura, banco de testes e script |
| [0015-traefik-proprio-opcional.md](0015-traefik-proprio-opcional.md) | Traefik próprio opcional | aceita | Traefik em perfil opcional, uso do Traefik existente no servidor de testes, domínio de testes |
| [0016-licenca-agpl-3.md](0016-licenca-agpl-3.md) | Licença AGPL-3.0 | aceita | Licença do repositório e suas consequências |
| [0017-escopo-do-mvp.md](0017-escopo-do-mvp.md) | Escopo do MVP | aceita | O que entra no MVP (aprendizado, comunidade, suporte), o que fica fora e a ordem das fases |
| [0018-vitrine-spa.md](0018-vitrine-spa.md) | Vitrine pública como SPA | provisória (indexação em buscadores insuficiente) | O que o visitante vê sem login, cases públicos e vitrine sem pré-renderização |
