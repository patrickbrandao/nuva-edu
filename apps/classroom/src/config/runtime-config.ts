/**
 * Configuração de execução do site (`/config.json`; specs 006 e 031).
 *
 * Mesma regra de leitura do site admin (`apps/admin/src/runtime/runtimeConfig.ts`): os dois
 * módulos andam juntos até a regra ir para um pacote compartilhado.
 *
 * O arquivo é servido pelo Nginx do próprio site (em desenvolvimento, pelo Vite) e é a única
 * chamada fora do cliente gerado. Só três campos são lidos: `app`, `adminUrl` e `classroomUrl`.
 * Moeda, idioma e versão vêm de `/api/v1/meta`, mesmo que o arquivo os traga.
 *
 * Nada aqui lança erro: arquivo ausente, ilegível ou com campo inválido vira campo ausente e um
 * aviso no console. O site abre do mesmo jeito, só sem o link para o outro site.
 */

export const RUNTIME_CONFIG_PATH = '/config.json';

export type RuntimeApp = 'admin' | 'classroom';

/** Só os campos válidos do arquivo; o que faltou ou veio fora do formato fica de fora. */
export interface RuntimeConfig {
  app?: RuntimeApp;
  /** Origem pública do site admin, sem barra no fim. */
  adminUrl?: string;
  /** Origem pública do site do aluno, sem barra no fim. */
  classroomUrl?: string;
}

export type RuntimeConfigLoader = () => Promise<RuntimeConfig>;

const URL_FIELDS = ['adminUrl', 'classroomUrl'] as const;

// Os avisos citam só o nome do campo, o status e o tipo do erro: nunca o conteúdo recebido.
function warn(message: string): void {
  console.warn(`[nuva] ${RUNTIME_CONFIG_PATH}: ${message}`);
}

/** URL de origem `http(s)://host[:porta]`, sem caminho, consulta nem barra no fim. */
function isOriginUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
}

/** Valida o corpo do arquivo campo a campo; devolve os válidos e os nomes dos inválidos. */
export function parseRuntimeConfig(body: unknown): { config: RuntimeConfig; invalid: string[] } {
  const config: RuntimeConfig = {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { config, invalid: ['app', ...URL_FIELDS] };
  }
  const source = body as Record<string, unknown>;
  const invalid: string[] = [];

  if (source.app === 'admin' || source.app === 'classroom') config.app = source.app;
  else invalid.push('app');

  for (const field of URL_FIELDS) {
    const value = source[field];
    if (isOriginUrl(value)) config[field] = value;
    else invalid.push(field);
  }
  return { config, invalid };
}

/** Busca e valida o `/config.json`, sem cache. Nunca rejeita. */
export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  let body: unknown;
  try {
    const response = await fetchFn(RUNTIME_CONFIG_PATH, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      warn(`resposta ${response.status}; os links para o outro site ficam ocultos.`);
      return {};
    }
    body = await response.json();
  } catch (error) {
    // Rede fora do ar ou corpo que não é JSON (ex.: o index.html devolvido no lugar do arquivo).
    const kind = error instanceof Error ? error.name : 'erro';
    warn(`não foi possível ler o arquivo (${kind}); os links para o outro site ficam ocultos.`);
    return {};
  }

  const { config, invalid } = parseRuntimeConfig(body);
  if (invalid.length > 0) {
    warn(`campo ausente ou fora do formato: ${invalid.join(', ')}.`);
  }
  if (config.app === 'admin') {
    warn('o arquivo diz ser do site admin, mas este é o site classroom.');
  }
  return config;
}
