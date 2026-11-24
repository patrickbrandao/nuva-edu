# 006 — Sites admin e classroom e a interface

Status: aprovada
Depende de: 000, 001, 003, 004, 008

## Contexto

O nuva-edu tem dois sites, ambos SPAs em React: `admin` (equipe) e `classroom` (alunos e visitantes). A aparência vem dos componentes do projeto minui-react, copiados para `packages/ui` ([0010](decisions/0010-interface-minui-em-packages-ui.md)). Esta spec define a casca, o mapa de telas e as regras comuns de interface; o comportamento de cada tela está na spec do recurso.

## Requisitos

- RF-01: Dois SPAs independentes: `apps/admin` servido em `https://<NUVA_ADMIN_HOST>/` e `apps/classroom` em `https://<NUVA_CLASSROOM_HOST>/`. Cada um fala só com a API do próprio domínio, em `/api/v1`.
- RF-02: Toda chamada HTTP usa o cliente gerado dos contratos em `packages/api-client`; nenhum site escreve URL de API à mão.
- RF-03: Componentes visuais vêm de `packages/ui`; um site só cria componente local quando ele é específico de uma tela.
- RF-04: Tema Sistema, Claro e Escuro, escolhido na barra superior e nas configurações, guardado no navegador (chave `nuva-theme`).
- RF-05: Todos os textos de interface em arquivos de tradução, um arquivo por idioma em cada site (`apps/<site>/src/locales/pt-BR.json`), com as chaves agrupadas por tela ou recurso dentro do arquivo; nenhum texto fixo em componente. Idioma único no MVP: pt-BR. O arquivo só é dividido por recurso (`locales/pt-BR/<recurso>.json`, carregado sob demanda) se passar a pesar na RNF-03.
- RF-06: Nome, logotipo e cor de destaque da escola vêm de `settings`, não do código. Os sites os leem de `GET /api/v1/meta` (`schoolName`, `logoUrl`, `accentColor`), que é o endpoint público de marca ([003](003-admin-api.md), "Meta"). Sem logotipo, mostra-se só o nome; sem cor, vale a cor de destaque padrão de `packages/ui`.
- RF-07: Navegação por URL: toda tela tem endereço próprio, recarregável e compartilhável; breadcrumb sempre com rótulo legível (nunca slug ou identificador).
- RF-08: Busca global (atalho `Ctrl/⌘ + K`) nos dois sites.
- RF-09: Estados de carregamento, vazio e erro em toda listagem e toda tela de detalhe; estado vazio sempre com uma ação sugerida.
- RF-10: O site admin mostra apenas os itens de menu e botões que o papel do usuário pode usar ([008](008-papeis-e-permissoes.md)); a API continua sendo quem decide.
- RF-11: O rodapé dos dois sites exibe o link "Código-fonte", apontando para o endereço de `sourceCodeUrl` do `GET /api/v1/meta` (padrão: o repositório público `https://github.com/patrickbrandao/nuva-edu`; ajustável nas configurações da escola, chave `school.source_code_url`, para quem distribui uma versão modificada), como a AGPL-3.0 exige para uso em rede ([0016](decisions/0016-licenca-agpl-3.md)).
- RF-12: O que depende da instalação chega ao site em tempo de execução, nunca no build: os dados da escola e da instalação por `GET /api/v1/meta`, e o endereço público dos dois sites por `/config.json` ([Configuração de execução](#configuração-de-execução)). A mesma imagem serve a qualquer instalação.
- RNF-01: Responsivo de 360 px a 1920 px de largura, sem rolagem horizontal; menu lateral vira gaveta abaixo de 1024 px.
- RNF-02: WCAG 2.1 nível AA nos fluxos principais (cadastro, login, vitrine, checkout, player, fórum, chamados): contraste mínimo 4,5:1, tudo operável por teclado, foco visível, rótulos em campos, `aria-live` em avisos.
- RNF-03: JavaScript inicial de cada site abaixo de 300 KB comprimido (gzip); demais telas carregadas sob demanda.
- RNF-04: Em conexão 4G simulada, vitrine com LCP abaixo de 2,5 s.
- RNF-05: Nenhuma dependência de CDN externa: fontes, ícones e scripts servidos pelo próprio site (exceto o player incorporado de vídeo e o checkout do Mercado Pago).

## Comportamento

### Base técnica

- React 19, Vite e Tailwind 4; React Router para rotas; TanStack Query para dados do servidor; ícones `lucide-react`.
- `packages/ui` contém: tokens (`--minui-*` com `light-dark()`), primitivos (Surface, Txt, Avatar, Badge, Dot, Field, LabelPill, ActionButton), a casca administrativa (`AdminShell`), os controles e as tabelas do `AdminKit` (`AdminControls`, `AdminData`), o quadro `CasesBoard`, a visão `ClientOverview` e a página `PricingPage`. Componentes que faltarem (player, editor de texto, calendário, acordeão de módulos, modal, toast) nascem em `packages/ui` seguindo os mesmos tokens.
- Quando uma tarefa citar um código de referência do minui (ex.: `CasesBoard.screen02`), o exemplo é localizado no projeto de origem e portado para `packages/ui`; o código de referência fica anotado em comentário no componente portado.
- Componentes de vitrine do minui sem uso no produto (personagens, palco, efeitos, teclado, metal líquido) não são copiados.
- Texto escrito por usuário é exibido a partir de Markdown restrito (negrito, itálico, listas, links, código, citação), sempre higienizado; nunca HTML bruto.
- Sessão: ao carregar, o site chama `GET /api/v1/session`; `401` leva à tela de login guardando o destino. O site admin, ao receber `403` por papel, mostra "sem acesso ao painel" com link para o classroom.
- Tempo real no classroom: uma conexão SSE por aba ([004](004-classroom-api.md)), que invalida as consultas afetadas.

### Configuração de execução

Cada dado tem uma única fonte ([031](031-infraestrutura-e-deploy.md), "Configuração de execução dos sites"):

| O site precisa de | Lê de |
| --- | --- |
| Nome, logotipo, cor de destaque, endereço do código-fonte | `GET /api/v1/meta` |
| Moeda, idioma, versão, provedores de login | `GET /api/v1/meta` |
| Endereço do outro site (`adminUrl`, `classroomUrl`) e qual site é este (`app`) | `/config.json` |

- Ao carregar, o site busca `/config.json` (sem cache) em paralelo com `/api/v1/meta` e `/api/v1/session`. É um arquivo estático do próprio site, fora de `/api/v1`, e por isso é a única chamada que não passa pelo cliente gerado (RF-02).
- O site não lê moeda, idioma nem versão do `/config.json`, mesmo que o arquivo os traga.
- Uso de `classroomUrl` no admin: o link para o classroom da tela "sem acesso ao painel" ([Base técnica](#base-técnica)).
- Uso de `adminUrl` no classroom: o item "Administração" do menu do usuário, mostrado só a quem tem papel de equipe ([008](008-papeis-e-permissoes.md)).
- Links para o próprio site são sempre relativos; `adminUrl` e `classroomUrl` só montam link para o outro site.
- `/config.json` ausente, ilegível ou sem o campo: o site funciona, os links para o outro site não aparecem e o problema é registrado no console do navegador. Nunca é tela de erro.
- No `vite dev`, o servidor de desenvolvimento do site responde `/config.json` com os mesmos campos, a partir das mesmas variáveis de ambiente e padrões.

### Casca comum

- Barra superior: recolher menu, breadcrumb, busca global, seletor de tema, sino de notificações (classroom), menu do usuário (perfil, configurações, sair).
- Menu lateral em grupos, recolhível; rodapé com avatar, nome e papel.
- Avisos por toast; ações destrutivas pedem confirmação com o nome do item.

### Mapa de telas — classroom

| Grupo | Tela | Rota | Login | Spec |
| --- | --- | --- | --- | --- |
| Público | Vitrine (cursos, pacotes, ebooks, planos) | `/` | Não | [009](009-catalogo-e-conteudo.md) |
| Público | Página do produto (descrição, preço, programa) | `/cursos/:slug`, `/pacotes/:slug`, `/ebooks/:slug` | Não | [009](009-catalogo-e-conteudo.md) |
| Público | Planos de assinatura (`PricingPage`) | `/planos` | Não | [012](012-assinaturas.md) |
| Público | Cases | `/cases`, `/cases/:slug` | Não | [022](022-cases.md) |
| Público | Validar certificado | `/certificados/:codigo` | Não | [015](015-certificados.md) |
| Público | Entrar, cadastrar, confirmar e-mail, redefinir senha | `/entrar`, `/cadastro`, `/confirmar`, `/redefinir` | Não | [007](007-contas-e-autenticacao.md) |
| Público | Termos e privacidade | `/termos`, `/privacidade` | Não | [030](030-lgpd.md) |
| Aprendizado | Início (saudação, continuar de onde parou, aulas de amostra, novidades, próximos eventos) | `/inicio` | Sim | [014](014-aprendizado-e-progresso.md) |
| Aprendizado | Meus cursos (estante com filtros, busca, grade ou lista) | `/meus-cursos` | Sim | [014](014-aprendizado-e-progresso.md) |
| Aprendizado | Curso (programa em acordeão, progresso) | `/meus-cursos/:slug` | Sim | [009](009-catalogo-e-conteudo.md) |
| Aprendizado | Aula (player, descrição, materiais, abas Notas e Comentários) | `/meus-cursos/:slug/aulas/:aula` | Sim | [014](014-aprendizado-e-progresso.md), [016](016-anotacoes.md), [017](017-forum.md) |
| Aprendizado | Meus ebooks | `/meus-ebooks` | Sim | [009](009-catalogo-e-conteudo.md) |
| Aprendizado | Calendário (agenda, gravações) | `/calendario` | Sim | [018](018-calendario-e-eventos.md) |
| Aprendizado | Anotações | `/anotacoes` | Sim | [016](016-anotacoes.md) |
| Aprendizado | Meu progresso e certificados | `/progresso` | Sim | [014](014-aprendizado-e-progresso.md), [015](015-certificados.md) |
| Comunidade | Fórum (categorias, tópicos, tópico) | `/forum`, `/forum/:categoria`, `/forum/t/:topico` | Sim | [017](017-forum.md) |
| Comunidade | Membros e ranking | `/membros`, `/ranking` | Sim | [019](019-perfil-e-diretorio.md), [020](020-gamificacao.md) |
| Comunidade | Perfil (visão geral, atividade, trabalho, conquistas) | `/membros/:usuario` | Sim | [019](019-perfil-e-diretorio.md) |
| Comunidade | Meus cases, publicar case | `/cases/meus`, `/cases/novo` | Sim | [022](022-cases.md) |
| Comunicação | Mensagens | `/mensagens`, `/mensagens/:conversa` | Sim | [021](021-mensagens-diretas.md) |
| Compra | Cesta, checkout, retorno do pagamento | `/cesta`, `/checkout`, `/pedidos/:id` | Sim | [011](011-vendas-e-checkout.md) |
| Conta | Minhas compras e assinatura | `/conta/compras` | Sim | [011](011-vendas-e-checkout.md), [012](012-assinaturas.md) |
| Conta | Novidades | `/novidades` | Sim | [025](025-novidades.md) |
| Conta | Notificações | `/notificacoes` | Sim | [024](024-notificacoes-e-email.md) |
| Conta | Suporte (chamados) | `/suporte`, `/suporte/:id` | Sim | [023](023-chamados-de-suporte.md) |
| Conta | Configurações (perfil, acesso e senha, notificações, aparência, privacidade) | `/conta/*` | Sim | [007](007-contas-e-autenticacao.md), [030](030-lgpd.md) |

Conteúdo sem direito de acesso mostra o programa, um aviso de bloqueio e o botão de compra dos produtos que o liberam; nunca uma tela de erro.

### Mapa de telas — admin

| Grupo | Tela | Rota | Papel mínimo | Spec |
| --- | --- | --- | --- | --- |
| — | Entrar | `/entrar` | — | [007](007-contas-e-autenticacao.md) |
| Visão geral | Painel (vendas do período, novos alunos, chamados abertos, denúncias, falhas de operação) | `/` | instructor (versão reduzida) | [003](003-admin-api.md) |
| Pessoas | Alunos (lista, filtros) e ficha do aluno (dados, acessos, compras, progresso, sessões, senha) — base `ClientOverview` | `/alunos`, `/alunos/:id` | manager | [007](007-contas-e-autenticacao.md), [010](010-direitos-de-acesso.md) |
| Pessoas | Equipe | `/equipe` | admin | [008](008-papeis-e-permissoes.md) |
| Conteúdo | Cursos, editor de curso (dados, módulos e aulas com arrastar, ebooks vinculados) | `/cursos`, `/cursos/:id` | instructor | [009](009-catalogo-e-conteudo.md) |
| Conteúdo | Ebooks, pacotes | `/ebooks`, `/pacotes` | manager | [009](009-catalogo-e-conteudo.md) |
| Conteúdo | Calendário de eventos | `/eventos` | manager | [018](018-calendario-e-eventos.md) |
| Conteúdo | Novidades | `/novidades` | manager | [025](025-novidades.md) |
| Vendas | Pedidos, detalhe do pedido, reembolso | `/pedidos`, `/pedidos/:id` | manager (reembolso: admin) | [011](011-vendas-e-checkout.md) |
| Vendas | Assinaturas | `/assinaturas` | manager | [012](012-assinaturas.md) |
| Vendas | Planos, cupons, preços | `/planos`, `/cupons` | admin | [011](011-vendas-e-checkout.md), [012](012-assinaturas.md) |
| Vendas | Exportar vendas (CSV) | `/pedidos/exportar` | manager | [011](011-vendas-e-checkout.md) |
| Comunidade | Fórum (categorias livres, tópicos) | `/forum` | instructor | [017](017-forum.md) |
| Comunidade | Denúncias | `/denuncias` | instructor | [026](026-moderacao-e-denuncias.md) |
| Comunidade | Cases (destaque, ocultar) | `/cases` | manager | [022](022-cases.md) |
| Comunidade | Gamificação (pontos, níveis, medalhas) | `/gamificacao` | manager (tabela: admin) | [020](020-gamificacao.md) |
| Suporte | Chamados em quadro — base `CasesBoard` — e conversa do chamado | `/chamados`, `/chamados/:id` | manager | [023](023-chamados-de-suporte.md) |
| Sistema | Chaves MCP (as próprias) | `/chaves-mcp` | manager | [027](027-mcp.md) |
| Sistema | Auditoria | `/auditoria` | admin | [028](028-auditoria.md) |
| Sistema | Operação (fila, e-mails, webhooks) | `/operacao` | admin | [005](005-worker-e-fila.md) |
| Sistema | Configurações (escola e marca, termos, pagamento, login social, e-mail) | `/configuracoes` | admin | [030](030-lgpd.md), [031](031-infraestrutura-e-deploy.md) |

A tela de configurações mostra o estado das integrações definidas por variável de ambiente (configurada ou não, último teste), sem exibir segredos.

### Busca global

- Classroom: cursos e aulas a que o usuário tem acesso, produtos da vitrine, tópicos de fórum visíveis e membros.
- Admin: alunos (nome, e-mail), cursos, pedidos (número) e chamados.
- Resultado agrupado por tipo, no máximo 5 por grupo, navegável por teclado.

### Casos de erro

- API fora do ar: faixa "sem conexão com o servidor" e nova tentativa automática; o que já está em tela continua legível.
- `403` por direito de acesso: tela de bloqueio com oferta de compra.
- `404`: página "não encontrado" com link para o início.
- Erro inesperado de renderização: tela de erro com o `X-Request-Id` da última chamada, para o aluno informar no chamado.

## Interfaces e contratos

- `apps/admin` consome `apps/admin-api/openapi.yaml`; `apps/classroom` consome `apps/classroom-api/openapi.yaml`, ambos por `packages/api-client`.
- Imagens servidas em `/api/v1/images/:id` ([029](029-imagens.md)).
- Sites entregues como arquivos estáticos por Nginx sem privilégios (`proxy/nginx/`, igual nas duas imagens); qualquer rota desconhecida devolve `index.html`, sem cache, e os arquivos de `/assets/`, com hash no nome, têm cache longo ([031](031-infraestrutura-e-deploy.md)). Caminho de API ou de sonda que chegue ao Nginx do site (`/api/`, `/mcp`, `/healthz`, `/readyz`, `/metrics`) responde `404`, não o `index.html`.
- `/config.json`: formato em [031](031-infraestrutura-e-deploy.md), "Configuração de execução dos sites".

## Dados

Os sites não são donos de dados. No navegador guardam apenas: tema (`nuva-theme`), menu recolhido, modo grade ou lista e rascunhos não enviados. Nenhum token de sessão é acessível ao JavaScript.

## Critérios de aceite

- [ ] Os dois sites constroem e sobem só com `packages/ui` e `packages/api-client`, sem depender do repositório do minui-react.
- [ ] Trocar o tema muda todas as telas, sem recarregar, nos três modos.
- [ ] Busca por texto fixo em português nos componentes não encontra nada fora de `locales/`.
- [ ] Cada rota das tabelas acima abre por endereço direto e mostra breadcrumb legível.
- [ ] `instructor` não vê itens de menu de `manager` ou `admin`; `manager` não vê os de `admin`.
- [ ] Fluxos principais passam na verificação automática de acessibilidade (axe) sem violações AA e são concluídos só com teclado.
- [ ] Telas utilizáveis a 360 px de largura, sem rolagem horizontal.
- [ ] Tamanho inicial de cada site dentro de RNF-03, verificado no build.
- [ ] O link para o outro site usa o endereço do `/config.json`; sem o arquivo, o site abre e o link não aparece.
- [ ] Nenhum site lê moeda, idioma ou versão de outra fonte que não o `/api/v1/meta`.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- Aplicativo nativo e PWA com uso offline.
- Idiomas além de pt-BR (a estrutura de tradução existe; os textos não).
- Canais de chat, "Postagens salvas" e "Presentes" ([0017](decisions/0017-escopo-do-mvp.md)).
- Pré-renderização da vitrine ([0018](decisions/0018-vitrine-spa.md)).
- Editor visual de tema além de logotipo e cor de destaque.

## Decisões relacionadas

- [0010 — Interface: minui em packages/ui](decisions/0010-interface-minui-em-packages-ui.md)
- [0018 — Vitrine como SPA](decisions/0018-vitrine-spa.md)
- [0009 — Stack TypeScript, Fastify e Kysely](decisions/0009-stack-typescript-fastify-kysely.md)
- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
