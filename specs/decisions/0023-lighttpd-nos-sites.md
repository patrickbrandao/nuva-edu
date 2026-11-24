# 0023 — lighttpd como servidor de arquivos dos sites

Status: aceita
Data: 2026-11-24

Substitui, na [0001](0001-decisoes-iniciais.md), a segunda metade da linha S-03 ("os sites são servidos por Nginx sem privilégios"). O resto da 0001 continua valendo. Não toca na [0015](0015-traefik-proprio-opcional.md): o Traefik continua sendo o proxy reverso.

## Contexto

Os contêineres `admin` e `classroom` só entregam arquivos estáticos; quem recebe o tráfego de fora e roteia é o Traefik. Até aqui o servidor de arquivos era o Nginx, pela imagem base `nginxinc/nginx-unprivileged:stable-alpine`.

Fatos de 2026-11-24:

- A base fixa o pacote do nginx na versão 1.30.6, com seis vulnerabilidades altas ou críticas. O `apk upgrade` do build não troca esse pacote: a correção só chega quando a base for republicada por terceiros.
- O fluxo `images` falha com vulnerabilidade alta ou crítica no Trivy ([032](../032-verificacao-e-ci.md)). A publicação dos dois sites ficou barrada, e a tarefa 118 abriu uma exceção temporária no Trivy, restrita aos sites e com prazo, para publicá-los.
- Medição no mesmo dia, com o Trivy do CI (altas e críticas com correção disponível):

| Servidor | Achados | Tamanho da imagem |
| --- | --- | --- |
| Nginx estável (base `nginx-unprivileged`, depois do `apk upgrade`) | 6 | 90 MB |
| Caddy 2.11.9 | 1 alta, dentro do binário Go | — |
| Alpine 3.24 + lighttpd 1.4.85 (pacote do Alpine) | 0 | 30 MB |

## Decisão

1. **Os sites `admin` e `classroom` são servidos por lighttpd**, instalado do pacote do Alpine numa imagem montada pelo próprio projeto (Alpine + `apk upgrade` + pacote do lighttpd). Não há imagem base de terceiros para o servidor.
2. **O Traefik continua sendo o proxy.** O lighttpd só entrega arquivos dentro de cada contêiner; não faz TLS, roteamento nem repasse para as APIs.
3. **O comportamento não muda** ([006](../006-sites-e-interface.md) e [031](../031-infraestrutura-e-deploy.md)): `index.html` de reserva para as rotas da SPA; `/config.json` gerado na subida do contêiner; `Content-Security-Policy` calculada no build, com o hash dos scripts embutidos no `index.html` (o do tema); `404` em `/api/`, `/mcp`, `/healthz`, `/readyz` e `/metrics`; `index.html` sem cache e arquivos com hash no nome com cache longo; usuário sem privilégio; raiz somente leitura; porta 8080.
4. **A configuração fica em `proxy/lighttpd/`**, igual nas duas imagens, no lugar de `proxy/nginx/`: o `lighttpd.conf`, o script de entrada que gera o `/config.json` e o gerador da CSP.
5. **A exceção temporária do Trivy (tarefa 118) deixa de existir** com a troca no código (tarefa 121): nenhuma imagem do projeto é publicada com exceção de vulnerabilidade.

## Alternativas consideradas

- **Esperar a republicação da base do Nginx.** Sem data, fora do nosso controle, e o problema volta a cada correção do nginx que a base demorar a trazer.
- **Nginx mainline.** Troca de linha de versões sem resolver a causa: o servidor continuaria vindo de uma imagem de terceiros, fora do alcance do `apk upgrade`.
- **Caddy.** Uma vulnerabilidade alta dentro do binário Go no dia da medição; a correção depende de nova versão do Caddy, o mesmo tipo de espera.
- **Servir os sites pelas APIs.** Acaba com dois contêineres, mas mistura entrega de arquivos com a API, muda o roteamento e o desenho de componentes ([001](../001-arquitetura.md), [0004](0004-duas-apis-um-banco.md)) e prende a publicação do site à da API.
- **Manter a exceção do Trivy.** Publicar com vulnerabilidade alta conhecida e renovar o prazo a cada vencimento contraria a regra do CI.

## Consequências

- Imagem própria a manter: Alpine, pacote do lighttpd, usuário sem privilégio e script de entrada. O que a base `nginx-unprivileged` trazia pronto (usuário, diretórios graváveis, execução de scripts na subida) passa a ser nosso.
- Configuração e geração da CSP reescritas para o lighttpd; os casos de comportamento listados acima são conferidos de novo em contêiner.
- Correção de segurança do servidor entra pelo `apk upgrade` de cada build, no ritmo do Alpine.
- Imagem dos sites cai de cerca de 90 MB para cerca de 30 MB.
- A exceção do Trivy e o arquivo que a guardava são removidos; o fluxo `images` volta a examinar as cinco imagens sem exceção.
- Recursos do Nginx que não usamos deixam de estar à mão; se um dia o site precisar de algo que o lighttpd não faz, a decisão é reaberta por ADR nova.
