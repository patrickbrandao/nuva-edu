// Roda o `proxy/lighttpd/entrypoint.sh` fora do contêiner, gravando numa pasta temporária
// (NUVA_CONFIG_DIR), e confere o `/config.json` dos sites (spec 031, "Configuração de execução
// dos sites") e a troca pelo comando recebido.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, '..', 'proxy/lighttpd/entrypoint.sh');

/** Só as variáveis do teste chegam ao script: nada do ambiente de quem roda. */
function run(env, command = []) {
  const dir = mkdtempSync(join(tmpdir(), 'nuva-config-'));
  try {
    const result = spawnSync('sh', [script, ...command], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NUVA_CONFIG_DIR: dir, ...env },
    });
    const file = join(dir, 'config.json');
    return { ...result, text: existsSync(file) ? readFileSync(file, 'utf8') : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function generate(env) {
  const result = run(env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.text);
}

test('o config.json tem exatamente app, adminUrl e classroomUrl', () => {
  const config = generate({
    NUVA_APP: 'admin',
    NUVA_ADMIN_HOST: 'edu-admin.escola.com.br',
    NUVA_CLASSROOM_HOST: 'classroom.escola.com.br',
    NUVA_PUBLIC_SCHEME: 'https',
    NUVA_PUBLIC_PORT: '',
    // Não são do arquivo: mesmo presentes, não aparecem nele.
    NUVA_CURRENCY: 'USD',
    NUVA_LOCALE: 'en-US',
    POSTGRES_PASSWORD: 'segredo-so-do-teste',
  });
  assert.deepEqual(config, {
    app: 'admin',
    adminUrl: 'https://edu-admin.escola.com.br',
    classroomUrl: 'https://classroom.escola.com.br',
  });
});

test('sem variáveis além de NUVA_APP valem os padrões do desenvolvimento', () => {
  assert.deepEqual(generate({ NUVA_APP: 'classroom' }), {
    app: 'classroom',
    adminUrl: 'http://edu-admin.localhost:8080',
    classroomUrl: 'http://classroom.localhost:8080',
  });
  assert.deepEqual(generate({ NUVA_APP: 'classroom', NUVA_DOMAIN: 'escola.test' }), {
    app: 'classroom',
    adminUrl: 'http://edu-admin.escola.test:8080',
    classroomUrl: 'http://classroom.escola.test:8080',
  });
});

test('a porta some da URL quando está vazia ou é a padrão do esquema', () => {
  const cases = [
    ['http', '', 'http://a.test'],
    ['http', '80', 'http://a.test'],
    ['http', '8080', 'http://a.test:8080'],
    ['http', '443', 'http://a.test:443'],
    ['https', '', 'https://a.test'],
    ['https', '443', 'https://a.test'],
    ['https', '8443', 'https://a.test:8443'],
    ['https', '80', 'https://a.test:80'],
  ];
  for (const [scheme, port, adminUrl] of cases) {
    const config = generate({
      NUVA_APP: 'admin',
      NUVA_ADMIN_HOST: 'a.test',
      NUVA_CLASSROOM_HOST: 'c.test',
      NUVA_PUBLIC_SCHEME: scheme,
      NUVA_PUBLIC_PORT: port,
    });
    assert.equal(config.adminUrl, adminUrl, `${scheme} com porta "${port}"`);
    assert.equal(config.classroomUrl, adminUrl.replace('a.test', 'c.test'));
  }
});

test('valor fora do formato impede a subida e cita a variável', () => {
  const base = { NUVA_APP: 'admin' };
  const cases = [
    [{}, 'NUVA_APP'],
    [{ NUVA_APP: 'worker' }, 'NUVA_APP'],
    [{ ...base, NUVA_ADMIN_HOST: 'https://painel.escola.test' }, 'NUVA_ADMIN_HOST'],
    [{ ...base, NUVA_ADMIN_HOST: 'painel.escola.test:8080' }, 'NUVA_ADMIN_HOST'],
    [{ ...base, NUVA_ADMIN_HOST: 'a","x":"b' }, 'NUVA_ADMIN_HOST'],
    [{ ...base, NUVA_CLASSROOM_HOST: 'aulas escola' }, 'NUVA_CLASSROOM_HOST'],
    [{ ...base, NUVA_CLASSROOM_HOST: '-aulas.test' }, 'NUVA_CLASSROOM_HOST'],
    [{ ...base, NUVA_DOMAIN: 'escola.test/' }, 'NUVA_ADMIN_HOST'],
    [{ ...base, NUVA_PUBLIC_SCHEME: 'ftp' }, 'NUVA_PUBLIC_SCHEME'],
    [{ ...base, NUVA_PUBLIC_PORT: '80a' }, 'NUVA_PUBLIC_PORT'],
    [{ ...base, NUVA_PUBLIC_PORT: '80\n' }, 'NUVA_PUBLIC_PORT'],
    [{ ...base, NUVA_ADMIN_HOST: 'a.test\nb.test' }, 'NUVA_ADMIN_HOST'],
  ];
  for (const [env, variable] of cases) {
    const result = run(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.match(result.stderr, new RegExp(variable), JSON.stringify(env));
    assert.equal(result.text, null, `${JSON.stringify(env)}: não grava o arquivo`);
  }
});

test('depois de gerar o arquivo, a entrada troca o processo pelo comando recebido', () => {
  const result = run({ NUVA_APP: 'admin' }, [
    'sh',
    '-c',
    'echo "pid=$$ args=$*" && exit 7',
    'x',
    'a',
    'b',
  ]);
  // O código de saída e a saída são os do comando: não sobra um `sh` pai entre o Docker e ele.
  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stdout, /config\.json gerado para o site admin\n.*args=a b\n$/);
  assert.ok(result.text, 'o arquivo é gravado antes do comando');
  const text = readFileSync(script, 'utf8');
  assert.match(text, /^set -eu$/m);
  assert.match(text, /^ {2}exec "\$@"$/m);
});

test('com variável inválida o comando não chega a rodar', () => {
  const result = run({ NUVA_APP: 'admin', NUVA_PUBLIC_SCHEME: 'ftp' }, ['sh', '-c', 'echo rodou']);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /rodou/);
  assert.match(result.stderr, /nuva-config: NUVA_PUBLIC_SCHEME inválida/);
});
