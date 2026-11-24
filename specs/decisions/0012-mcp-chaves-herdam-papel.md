# 0012 — MCP: chaves herdam o papel do emissor

Status: aceita
Data: 2026-11-24

## Contexto

O usuário determinou que o software de administração tenha um servidor MCP, com chaves emitidas por admin ou gerente, que herdam os poderes de quem emitiu, revogáveis e em quantidade livre.

## Decisão

(F2-10, A-06)

- O MCP é servido pela `admin-api`, por Streamable HTTP, em `https://<NUVA_ADMIN_HOST>/mcp`, com a chave no cabeçalho de autorização.
- As ferramentas espelham a API administrativa (usuários, conteúdo, acessos, vendas, fórum, chamados) e são filtradas pelo papel atual do emissor: rebaixar, suspender ou excluir o emissor afeta as chaves dele na hora.
- `admin` e `manager` emitem chaves; cada um pode ter várias, com nome, data de último uso e validade opcional, revogáveis a qualquer momento.
- A chave é exibida uma única vez, na emissão, e guardada só como hash em `mcp_keys`.
- A senha de usuários nunca é exposta pelo MCP ([0002](0002-senha-em-texto-legivel.md)).
- Auditoria: há um registro imutável (`audit_log`) de toda ação da equipe e de toda chamada do MCP, com quem, o quê, quando, IP e chave usada.

## Alternativas consideradas

- MCP somente leitura no MVP: mais seguro para começar, mas adiaria a administração por agente.
- Chave com escopo escolhido na emissão (só leitura, conteúdo, usuários): mais controle, mais tela e mais regra.

## Consequências

- Uma chave de admin vazada equivale à conta do admin, exceto pela leitura de senhas; revogação e validade são as contenções, e a auditoria permite reconstruir o que foi feito.
- Elevação de privilégio por chave MCP é ameaça do modelo (Q-03): a permissão é verificada a cada chamada, com a mesma função de `packages/core` usada pela API.
- Toda capacidade administrativa nova precisa decidir se vira ferramenta MCP; a lista de ferramentas é mantida em [027](../027-mcp.md).
- O MCP é a única interface para terceiros; não há outra API pública (A-04).
- Detalhado em [027](../027-mcp.md) e [028](../028-auditoria.md).
