# 000 — Visão geral

Status: aprovada
Depende de: —

## Contexto

O nuva-edu é uma plataforma de cursos online instalável: cada instalação atende uma escola, que vende e entrega conteúdo educacional e dá suporte aos seus alunos. Tem dois sites:

- **admin** (`edu-admin.<dominio>`): gestão de alunos, conteúdo, vendas, moderação e suporte, pela equipe da escola. Também expõe um servidor MCP para agentes de IA.
- **classroom** (`classroom.<dominio>`): vitrine pública, compra, aulas, fórum, comunidade e suporte, para os alunos.

O código é aberto (AGPL-3.0), em `github.com/patrickbrandao/nuva-edu`, com imagens em `tmsoftbrasil/nuva-edu-<app>` no Docker Hub.

### Usuários

| Persona | Papel | O que faz |
| --- | --- | --- |
| Visitante | — | Vê a vitrine, os cases públicos e valida certificados. |
| Aluno | `student` | Cadastra-se livremente, compra, assiste, participa do fórum e da comunidade, abre chamados. |
| Instrutor | `instructor` | Edita os próprios cursos e modera o fórum deles. |
| Gerente | `manager` | Modera, atende chamados, edita conteúdo, concede acesso, vê vendas. |
| Administrador | `admin` | Poder total: preços, planos, cupons, reembolso, configurações, equipe. |
| Agente de IA | chave MCP | Age com os poderes de quem emitiu a chave. |

## Requisitos

### Funcionais (MVP)

- RF-01: Cadastro e login por e-mail e senha, Google, Facebook e Apple, convivendo na mesma conta ([007](007-contas-e-autenticacao.md)).
- RF-02: Quatro papéis com permissões distintas ([008](008-papeis-e-permissoes.md)).
- RF-03: Catálogo de cursos (Curso > Módulo > Aula), ebooks e pacotes, com conteúdo por link externo ([009](009-catalogo-e-conteudo.md)).
- RF-04: Modos de acesso aberto, pago e privado, com aulas de amostra, e aquisição em cascata ([010](010-direitos-de-acesso.md)).
- RF-05: Venda avulsa com cesta, cupons e reembolso ([011](011-vendas-e-checkout.md)) e assinatura por planos ([012](012-assinaturas.md)), pelo Mercado Pago ([013](013-pagamentos-mercado-pago.md)).
- RF-06: Player, progresso e estante ([014](014-aprendizado-e-progresso.md)), certificados ([015](015-certificados.md)) e anotações ([016](016-anotacoes.md)).
- RF-07: Fórum com categorias por curso, tópico por aula e categorias livres ([017](017-forum.md)).
- RF-08: Calendário de lives e eventos ([018](018-calendario-e-eventos.md)).
- RF-09: Comunidade: perfil e diretório ([019](019-perfil-e-diretorio.md)), gamificação ([020](020-gamificacao.md)), mensagens diretas ([021](021-mensagens-diretas.md)) e cases ([022](022-cases.md)).
- RF-10: Suporte: chamados ([023](023-chamados-de-suporte.md)), notificações e e-mail ([024](024-notificacoes-e-email.md)), novidades ([025](025-novidades.md)).
- RF-11: Moderação posterior com denúncias ([026](026-moderacao-e-denuncias.md)).
- RF-12: Servidor MCP administrativo com chaves revogáveis ([027](027-mcp.md)) e auditoria ([028](028-auditoria.md)).
- RF-13: LGPD: aceite de termos, exportação e exclusão de conta ([030](030-lgpd.md)).
- RF-14: Nomes DNS dos dois sites configuráveis por variável de ambiente ([031](031-infraestrutura-e-deploy.md)).

### Não funcionais

- RNF-01: Porte-alvo por instalação: 10.000 usuários cadastrados e 500 simultâneos em 2 vCPU e 4 GB de RAM, nó único.
- RNF-02: p95 das respostas das APIs abaixo de 300 ms com 500 usuários simultâneos (excluídas chamadas ao Mercado Pago e o fluxo SSE).
- RNF-03: Instalação nova no ar em até 15 minutos com `docker compose up`, seguindo a documentação.
- RNF-04: Do cadastro à primeira aula de um curso comprado em até 3 minutos (pagamento aprovado na hora).
- RNF-05: Interface em pt-BR, com todos os textos em arquivos de tradução; uma moeda por instalação (`NUVA_CURRENCY`, padrão BRL).
- RNF-06: Web responsiva a partir de 360 px de largura; sem aplicativo nativo.
- RNF-07: WCAG 2.1 nível AA nos fluxos principais: cadastro, login, compra, assistir aula, fórum.
- RNF-08: Disponibilidade é responsabilidade de quem instala; o software reinicia sem perda de dados e expõe verificações de saúde ([033](033-observabilidade-retencao-backup.md)).
- RNF-09: Retenção de dados não vitais conforme [033](033-observabilidade-retencao-backup.md).

## Comportamento

Fluxos principais, de ponta a ponta:

1. **Instalar**: configurar `.env.local`, subir o compose; o admin inicial nasce das variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
2. **Publicar**: admin, gerente ou instrutor cadastra curso, módulos e aulas com links; define modo de acesso e preço (preço só pelo admin); publica.
3. **Vender**: visitante vê a vitrine, cadastra-se, põe itens na cesta, paga no Mercado Pago; a confirmação gera os direitos de acesso em cascata.
4. **Ensinar**: aluno assiste, conclui aulas, anota, comenta (o comentário é resposta no tópico da aula), recebe o certificado ao concluir 100%.
5. **Apoiar**: aluno abre chamado; equipe responde; notificações chegam pelo sino e por e-mail.
6. **Administrar por agente**: admin ou gerente emite chave MCP; o agente opera dentro dos poderes do emissor, com tudo auditado.

## Interfaces e contratos

- Site admin, site classroom, duas APIs HTTP e um servidor MCP. Detalhes em [001](001-arquitetura.md).

## Dados

Entidades e donos em [001](001-arquitetura.md).

## Critérios de aceite

- [ ] Os seis fluxos acima funcionam de ponta a ponta no ambiente de teste.
- [ ] RNF-01 e RNF-02 comprovados por teste de carga antes da versão 1.0.
- [ ] RNF-03 comprovado seguindo a documentação numa máquina limpa.

## Fora de escopo

- Canais de chat em tempo real.
- Upload e hospedagem de vídeo, ebook ou arquivo de aula.
- Provas e questionários.
- Emissão de nota fiscal (há exportação de vendas em CSV).
- Repasse financeiro a instrutores e programa de afiliados.
- Multi-tenant, aplicativo nativo, Kubernetes.
- Resumo semanal por e-mail, "Presentes" e "Postagens salvas".
- Verificação em duas etapas.

## Restrições

- Equipe: uma pessoa com agentes de IA; sem data fixa; entregas por fase ([PLAN](PLAN.md)).
- Integrações obrigatórias: Mercado Pago, Google, Facebook, Apple, SMTP.
- Compliance: LGPD.

## Decisões relacionadas

- [0003 — Instalável, single-tenant](decisions/0003-instalavel-single-tenant.md)
- [0005 — Modelo de venda e Mercado Pago](decisions/0005-modelo-de-venda-e-mercado-pago.md)
- [0006 — Conteúdo por link externo](decisions/0006-conteudo-por-link-externo.md)
- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
