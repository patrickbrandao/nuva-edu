// Gera o código de `src/generated` a partir dos contratos OpenAPI (em memória).
// `generate.mjs` grava o resultado; `check.mjs` compara com o que está commitado.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse } from 'yaml';

const PACKAGE_ROOT = new URL('../', import.meta.url);
const REPO_ROOT = new URL('../../', PACKAGE_ROOT);

/** Pasta do código gerado (commitada; a raiz do Biome ignora `generated`). */
export const GENERATED_DIR = fileURLToPath(new URL('src/generated/', PACKAGE_ROOT));

/** Contratos de origem: nome da API e caminho do `openapi.yaml`. */
export const CONTRACTS = {
  admin: fileURLToPath(new URL('apps/admin-api/openapi.yaml', REPO_ROOT)),
  classroom: fileURLToPath(new URL('apps/classroom-api/openapi.yaml', REPO_ROOT)),
};

/** Esquema que reúne os eventos SSE (`oneOf` com discriminador em `event`). */
const STREAM_SCHEMA = 'StreamEvent';

function banner(api) {
  return [
    '// ARQUIVO GERADO. Não edite à mão.',
    `// Origem: apps/${api}-api/openapi.yaml`,
    '// Para atualizar: pnpm --filter @nuva-edu/api-client generate',
    '',
    '',
  ].join('\n');
}

/**
 * Nomes de evento do fluxo SSE, lidos do discriminador de `StreamEvent`.
 * Devolve `null` quando o contrato não tem fluxo.
 */
function streamEventNames(document) {
  const schema = document?.components?.schemas?.[STREAM_SCHEMA];
  if (!schema) return null;
  const mapping = schema.discriminator?.mapping;
  if (schema.discriminator?.propertyName !== 'event' || !mapping) {
    throw new Error(
      `${STREAM_SCHEMA}: esperado "discriminator" com propertyName "event" e "mapping" de todos os eventos`,
    );
  }
  const mapped = Object.values(mapping).sort();
  const listed = (schema.oneOf ?? []).map((item) => item.$ref).sort();
  if (JSON.stringify(mapped) !== JSON.stringify(listed)) {
    throw new Error(
      `${STREAM_SCHEMA}: "oneOf" e "discriminator.mapping" listam esquemas diferentes`,
    );
  }
  // O openapi-typescript tipa `event` pela chave do mapping e ignora o `const` do esquema;
  // os dois precisam dizer o mesmo, senão o tipo gerado esconderia a divergência.
  for (const [name, ref] of Object.entries(mapping)) {
    const schemaName = ref.replace('#/components/schemas/', '');
    const declared = document.components.schemas[schemaName]?.properties?.event?.const;
    if (declared !== name) {
      throw new Error(
        `${STREAM_SCHEMA}: o mapping chama "${name}" o evento que ${schemaName} declara como "${declared}"`,
      );
    }
  }
  return Object.keys(mapping);
}

function renderStreamModule(api, names) {
  const lines = names.map((name) => `  ${JSON.stringify(name)},`);
  return [
    banner(api).trimEnd(),
    '',
    `/** Nomes de evento do fluxo SSE (discriminador de \`${STREAM_SCHEMA}\`). */`,
    'export const streamEventNames = [',
    ...lines,
    '] as const;',
    '',
  ].join('\n');
}

/**
 * Gera os arquivos de uma API. Devolve `{ nomeDoArquivo: conteúdo }`.
 * @param {string} api
 * @param {string} contractPath
 * @returns {Promise<Record<string, string>>}
 */
export async function renderContract(api, contractPath) {
  const ast = await openapiTS(pathToFileURL(contractPath), { silent: true });
  const files = { [`${api}.ts`]: banner(api) + astToString(ast) };
  const names = streamEventNames(parse(await readFile(contractPath, 'utf8')));
  if (names) files[`${api}-stream.ts`] = renderStreamModule(api, names);
  return files;
}

/**
 * Gera os arquivos de todas as APIs.
 * @param {Record<string, string>} [contracts]
 * @returns {Promise<Record<string, string>>}
 */
export async function renderAll(contracts = CONTRACTS) {
  const files = {};
  for (const [api, contractPath] of Object.entries(contracts)) {
    Object.assign(files, await renderContract(api, contractPath));
  }
  return files;
}

/**
 * Lê `--contract <api>=<caminho>` da linha de comando, para apontar uma API a outro arquivo
 * de contrato (usado nos testes, com cópia temporária).
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
export function contractsFromArgs(argv) {
  const contracts = { ...CONTRACTS };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--contract') throw new Error(`argumento desconhecido: ${argv[index]}`);
    const value = argv[index + 1] ?? '';
    const separator = value.indexOf('=');
    const api = value.slice(0, separator);
    if (separator < 1 || !(api in CONTRACTS)) {
      throw new Error(`use --contract <${Object.keys(CONTRACTS).join('|')}>=<caminho>`);
    }
    contracts[api] = value.slice(separator + 1);
    index += 1;
  }
  return contracts;
}
