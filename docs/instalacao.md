# Instalação

Derivado de `specs/031-infraestrutura-e-deploy.md`. Em caso de divergência, vale a spec.

Este guia cresce a cada fase; o passo a passo completo de uma instalação limpa chega com a
versão 1.0. Por ora ele cobre a porta dos serviços e o IP real do cliente atrás do proxy. Para o
ambiente de desenvolvimento, veja [ambiente-local.md](ambiente-local.md).

## Porta do PostgreSQL

Fora do desenvolvimento o banco não publica porta no hospedeiro: fica só na rede interna do
Compose. Com `NUVA_DOMAIN` diferente de `localhost` esse é o padrão do `pnpm compose`; o
`docker compose` chamado direto nunca publica. Para abrir `127.0.0.1:${NUVA_POSTGRES_PORT}` numa
manutenção, ponha `NUVA_POSTGRES_PUBLISH=true` no `.env.local` e rode
`pnpm compose up -d postgres`; para fechar, `false` (ou tire a linha) e rode de novo. Cada troca
recria o contêiner do banco. Detalhes em [ambiente-local.md](ambiente-local.md).

## Porta dos serviços (`PORT`)

As duas APIs e o worker escutam na porta de `PORT`, com padrão 3000. No Compose a variável não é
definida: dentro do contêiner a porta é sempre 3000, e é ela que os `healthcheck` e os rótulos do
Traefik usam.

Não ponha `PORT` no `.env` nem no `.env.local`. Os serviços leem esses arquivos (`env_file`), a
variável chegaria ao contêiner, o serviço sairia da porta 3000 e o `healthcheck` e o proxy
deixariam de alcançá-lo.

`PORT` existe para rodar os processos lado a lado fora do contêiner, na linha de comando:

```bash
PORT=3001 pnpm --filter @nuva-edu/classroom-api dev
```

## IP real do cliente (`TRUSTED_PROXIES`)

As APIs só aceitam `X-Forwarded-For` (e `X-Real-IP`) quando a conexão vem de um endereço de
`TRUSTED_PROXIES`. Fora disso vale o endereço da conexão TCP. Esse IP alimenta o limite de
tentativas de login, a auditoria e os logs.

Vazia ou ausente, a variável vale a lista padrão:

| Faixa | O que é |
| --- | --- |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | Redes privadas (as redes do Docker caem aqui) |
| `100.64.0.0/10` | CGNAT; redes de sobreposição e balanceadores internos de provedores |
| `127.0.0.0/8`, `::1/128` | Laço local |
| `169.254.0.0/16`, `fe80::/10` | Link-local |
| `fc00::/7` | Endereços locais únicos do IPv6 |

O padrão é amplo para funcionar atrás de qualquer proxy sem configuração. Na maioria das
instalações não é preciso mexer.

### Quando restringir

Restrinja quando algum usuário chega às APIs com endereço real dentro dessas faixas:

- a escola acessa o servidor pela própria rede interna;
- o servidor e os clientes estão atrás do mesmo CGNAT do provedor.

Nesses casos o cliente é tratado como proxy, e o `X-Forwarded-For` que ele enviar é aceito: ele
pode forjar o próprio IP e escapar do limite de tentativas de login.

### Exemplo: só a rede do Traefik

1. Descubra a faixa da rede do proxy (o valor de `TRAEFIK_NETWORK`; `nuva-edu-proxy` com o
   Traefik próprio):

   ```bash
   docker network inspect nuva-edu-proxy --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
   ```

   A saída é algo como `172.18.0.0/16`.

2. Grave a faixa no `.env.local`:

   ```bash
   TRUSTED_PROXIES=172.18.0.0/16
   ```

3. Recrie as APIs para a variável valer:

   ```bash
   pnpm compose up -d admin-api classroom-api
   ```

Cuidados:

- A variável aceita endereços e faixas CIDR separados por vírgula e, definida, substitui a lista
  padrão inteira. Se há outro proxy ou balanceador na frente do Traefik, a faixa dele não entra
  aqui: quem fala com as APIs é o Traefik.
- O Docker escolhe a faixa quando cria a rede. Se a rede for apagada e recriada, confira a faixa
  de novo. Com a faixa errada, as APIs passam a registrar o IP do Traefik como se fosse o do
  cliente, e o limite de tentativas de login passa a valer para todos os usuários juntos.
- Valor que não é IP nem faixa CIDR impede a subida das APIs, e a mensagem cita a variável.

Para conferir, entre no site e veja nas linhas de log da API o campo `client_ip` (o IP atribuído
ao cliente) ao lado de `peer_ip` (o endereço da conexão, que deve ser o do Traefik):

```bash
pnpm compose logs --tail 20 classroom-api
```
