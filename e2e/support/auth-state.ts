// Onde o projeto `setup` guarda a sessão do admin inicial, para os testes que só precisam do
// painel já aberto. Fica em `tmp/` da raiz, fora do Git: o arquivo tem o cookie da sessão.
import { resolve } from 'node:path';
import { ROOT_DIR } from './env.ts';

export const ADMIN_STATE = resolve(ROOT_DIR, 'tmp', 'playwright', 'auth', 'admin.json');
