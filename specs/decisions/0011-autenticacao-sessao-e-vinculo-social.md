# 0011 — Autenticação: sessão por cookie, cadastro único e vínculo social

Status: aceita
Data: 2026-11-24

## Contexto

O sistema aceita login por Google, Facebook, Apple e e-mail com senha, e os modos convivem na mesma conta. Há dois sites com públicos diferentes e quatro papéis. A senha fica em texto legível ([0002](0002-senha-em-texto-legivel.md)).

## Decisão

- Sessão (F2-05): cookie `httpOnly` e `Secure` com identificador opaco; as sessões ficam na tabela `sessions`. Cada site tem o próprio cookie no próprio domínio, e cada API é servida em `/api` do seu site, sem CORS. Sair, suspender o usuário ou trocar a senha derruba a sessão na hora.
- Contas (F2-06): cadastro único na tabela `users`, com papel `student`, `instructor`, `manager` ou `admin`. A equipe usa a mesma conta no classroom e no admin. O site admin recusa quem é só aluno.
- Admin inicial (F2-07): `ADMIN_EMAIL` e `ADMIN_PASSWORD`, sem valor padrão, criam o admin na primeira subida, somente se ainda não existir nenhum. Um comando de linha na imagem da `admin-api` recria ou redefine o admin em emergência.
- Vínculo social (F2-08): se o provedor atesta que o e-mail é verificado e já existe conta com ele, o login entra nessa conta e o provedor fica vinculado. Cadastro por e-mail e senha exige confirmar o e-mail por link antes de comprar ou postar. E-mail oculto da Apple vira conta própria, vinculável depois no perfil.
- Proteção de login (F4-07): 5 erros por IP ou por conta bloqueiam por 15 minutos; aviso por e-mail de login em dispositivo novo; comparação em tempo constante. Não há verificação em duas etapas, por decisão do usuário e contra a recomendação.

## Alternativas consideradas

- JWT curto com refresh: revogação imediata fica difícil e o ganho de desempenho é irrelevante neste porte.
- Equipe em cadastro separado: o instrutor precisaria de segunda conta para aparecer no fórum.
- Admin inicial só por comando de linha; tela de instalação na primeira visita (quem chegar primeiro vira admin).
- Vínculo social só manual, pelo perfil: mais rígido e confuso para o aluno.
- Verificação em duas etapas (TOTP) obrigatória para admin e gerente (recomendada) ou opcional para todos.

## Consequências

- Toda requisição autenticada consulta o banco pela sessão; aceitável no porte-alvo.
- Risco aceito: sem segunda etapa, a senha do admin é a única barreira do painel.
- Tomada de conta por vínculo indevido é ameaça do modelo (Q-03): só se une conta quando o provedor declara o e-mail verificado, e o cadastro por senha não confirmado não pode "reservar" o e-mail de outra pessoa.
- Quando um login social com e-mail verificado se une a uma conta local cujo e-mail ainda não tinha sido confirmado, a senha anterior dessa conta é apagada, porque pode ter sido definida por outra pessoa; o dono define uma nova pelo perfil ou por "esqueci a senha". Isso não altera a regra da [0002](0002-senha-em-texto-legivel.md): a senha, quando existe, continua guardada em texto legível.
- A sessão expira com 30 dias sem uso (F4-06).
- O IP do cliente vem dos cabeçalhos do proxy, confiando só em `TRUSTED_PROXIES`; o limite por IP depende disso.
- São necessários aplicativos de login no Google, no Facebook e na Apple antes da Fase 1 do PLAN (credencial externa: escalonar ao humano). Provedor fora do ar não impede os demais métodos (A-05).
- Detalhado em [007](../007-contas-e-autenticacao.md) e [008](../008-papeis-e-permissoes.md).
