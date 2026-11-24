# 0015 — Traefik próprio opcional

Status: aceita
Data: 2026-11-24

## Contexto

O proxy reverso é o Traefik, por determinação do usuário. O servidor de testes já tem um Traefik compartilhado com outros projetos, nas portas 80 e 443; uma instalação nova e o Docker Desktop local não têm nenhum.

Levantado no servidor de testes: rede `network_public`, entrypoints `web` e `websecure`, resolvedor de certificado `letsencrypt` (desafio HTTP) e `exposedbydefault=false`. Os nomes `edu-admin.opencode.tmsoft.com.br` e `classroom.opencode.tmsoft.com.br` já resolvem para o servidor.

## Decisão

- (F3-05) O compose traz um Traefik próprio em perfil opcional, usado no desenvolvimento local e em instalações novas. Onde já existe um Traefik, o perfil fica desligado e os contêineres entram na rede dele, só com rótulos. Rede, entrypoints e resolvedor de certificado vêm de `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINTS` e `TRAEFIK_CERTRESOLVER`.
- (F3-06) No servidor de testes, o domínio base é `opencode.tmsoft.com.br` e usa-se o Traefik existente, sem alterá-lo.
- No desenvolvimento, o Traefik próprio publica HTTP na porta 8080 para `edu-admin.localhost` e `classroom.localhost` (S-04).

## Alternativas consideradas

- Sempre subir o Traefik próprio: no servidor de testes ficaria em proxy duplo ou em outras portas.
- Nunca trazer Traefik: instalação nova deixaria de funcionar com um único `docker compose up`.
- Outro domínio base para testes: não foi necessário.

## Consequências

- O mesmo compose atende dev, teste e produção, variando só o perfil e as variáveis.
- Os rótulos precisam funcionar nos dois cenários; o roteamento é testado em ambos na Fase 0 do PLAN.
- O Traefik do servidor de testes é compartilhado: nenhum agente o reconfigura, e qualquer ação lá além do `deploy:test` é escalonada ao humano (O-07).
- As APIs confiam nos cabeçalhos de IP só quando vindos de `TRUSTED_PROXIES`.
- Detalhado em [031](../031-infraestrutura-e-deploy.md).
