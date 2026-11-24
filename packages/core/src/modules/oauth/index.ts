// Login social (spec 007, ADR 0024): interface única dos provedores Google, Facebook e Apple,
// troca do código com PKCE, validação do `id_token` (jose), cookie de retorno assinado, tabela
// de vínculo e cadastro pendente. Tarefa 148.

export * from './cookie.ts';
export * from './errors.ts';
export * from './fake.ts';
export * from './flow.ts';
export * from './linking.ts';
export * from './provider.ts';
export * from './providers.ts';
