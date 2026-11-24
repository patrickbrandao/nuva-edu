# 0024 — Provedor OAuth simulado para desenvolvimento e testes

Status: aceita
Data: 2026-11-24

## Contexto

A Fase 1 entrega login por Google, Facebook e Apple ([007](../007-contas-e-autenticacao.md)). Os três dependem de aplicativos registrados nos provedores, com credenciais que só o humano consegue obter ([0011](0011-autenticacao-sessao-e-vinculo-social.md), escalonamento em [002](../002-organizacao-do-trabalho.md)). Sem elas, o código social não poderia ser testado de ponta a ponta, e a fase ficaria parada esperando a credencial. Mesmo com credenciais reais, o e2e não pode depender de contas pessoais de terceiros nem de telas de login externas.

## Decisão

- Cada provedor é uma implementação de uma interface única em `packages/core` (`authorizationUrl`, `exchangeCode`, leitura da identidade), com os endereços do provedor (autorização, troca do código, identidade, JWKS) como configuração, não como constante espalhada pelo código.
- Um simulador próprio (`scripts/oauth-mock/`, serviço do Compose no perfil `oauth-mock`) imita o necessário dos três provedores: tela de autorização onde o teste escolhe a identidade, troca do código com PKCE, `id_token` assinado com JWKS (Google e Apple), `form_post` (Apple) e `/me` no formato do Graph (Facebook).
- `NUVA_OAUTH_MOCK_URL` (e `NUVA_OAUTH_MOCK_INTERNAL_URL`, para a troca do código pela rede interna) aponta os três provedores para o simulador, com credenciais fixas de teste. É recusada com `NUVA_ENV=production`, e com ela definida as credenciais reais são ignoradas.
- Testes de unidade e de integração usam um provedor falso em memória; o e2e usa o simulador; a configuração real é só preencher as variáveis de cada provedor.
- O simulador não é publicado como imagem nem entra no perfil padrão.

## Alternativas consideradas

- Esperar as credenciais reais: bloqueia a fase e torna o e2e dependente de contas externas.
- Um servidor OpenID genérico de terceiros (por exemplo, o `mock-oauth2-server`): cobre Google, mas não o formato do Facebook nem o `form_post` com o campo `user` da Apple; seria mais uma imagem de terceiros para o Trivy.
- Um provedor `fake` dentro das próprias APIs: mais simples, mas o fluxo testado deixaria de passar pelo redirecionamento, pela troca do código e pela validação do `id_token`, que são justamente os pontos frágeis.

## Consequências

- O código de produção é exercitado inteiro nos testes; o que fica sem teste automático é a aceitação real de cada provedor, conferida à mão quando as credenciais chegarem.
- Existe uma variável que, ligada em produção, permitiria entrar em qualquer conta; por isso a recusa com `NUVA_ENV=production` é verificada por teste, e o servidor de testes só a liga se o humano decidir.
- O simulador precisa acompanhar o formato dos provedores reais; diferença descoberta com as credenciais reais vira tarefa para o simulador e para o código.
