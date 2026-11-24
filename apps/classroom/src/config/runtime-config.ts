/**
 * Configuração de execução do site (specs 006 e 031, "Configuração de execução"): qual site é
 * este e o endereço público dos dois sites. Vem de `/config.json`, arquivo estático gerado na
 * subida do contêiner, e por isso é a única chamada fora do cliente gerado da API.
 */
export interface RuntimeConfig {
  app: 'admin' | 'classroom';
  /** Origem pública do site de administração, sem barra no fim. */
  adminUrl: string;
  /** Origem pública do site do aluno, sem barra no fim. */
  classroomUrl: string;
}

export const RUNTIME_CONFIG_PATH = '/config.json';

/** URL absoluta `http` ou `https`. */
function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Confere o formato e devolve só os três campos que o site lê: moeda, idioma e versão vêm do
 * `/api/v1/meta`, mesmo que o arquivo os traga. Fora do formato, devolve `null`.
 */
export function parseRuntimeConfig(value: unknown): RuntimeConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const { app, adminUrl, classroomUrl } = value as Record<string, unknown>;
  if (app !== 'admin' && app !== 'classroom') return null;
  if (!isHttpUrl(adminUrl) || !isHttpUrl(classroomUrl)) return null;
  return { app, adminUrl, classroomUrl };
}

function warn(reason: string): null {
  console.warn(
    `[nuva-edu] ${RUNTIME_CONFIG_PATH} ${reason}; os links para o outro site ficam ocultos.`,
  );
  return null;
}

/**
 * Busca e valida o `/config.json`, sem cache. Nunca lança: arquivo ausente (o retorno da SPA
 * responde o `index.html`), ilegível ou fora do formato devolve `null` e o motivo vai ao console.
 */
export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeConfig | null> {
  try {
    const response = await fetchImpl(RUNTIME_CONFIG_PATH, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return warn(`respondeu ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return warn('não é um JSON');
    }
    return parseRuntimeConfig(body) ?? warn('está fora do formato esperado');
  } catch {
    return warn('não pôde ser carregado');
  }
}
