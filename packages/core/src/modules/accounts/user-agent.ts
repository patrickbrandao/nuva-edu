// Dispositivo lido do `User-Agent` (spec 007, "Bloqueio e dispositivo novo"): família do
// navegador e sistema, sem versão. Usado em `user_devices.device_key`, na lista de sessões e no
// e-mail `account.new_login`.

export interface UserAgentInfo {
  /** Família do navegador (`Chrome`, `Firefox`...), ou `null` quando não reconhecida. */
  browser: string | null;
  /** Sistema (`macOS`, `Windows`...), ou `null` quando não reconhecido. */
  os: string | null;
}

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\/|\bChromium\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/** Sem `User-Agent` ou fora dos reconhecidos, o campo vem nulo. */
const UNKNOWN = 'Outro';

function firstMatch(text: string, table: ReadonlyArray<readonly [RegExp, string]>): string | null {
  for (const [pattern, name] of table) {
    if (pattern.test(text)) {
      return name;
    }
  }
  return null;
}

export function parseUserAgent(userAgent: string | null | undefined): UserAgentInfo {
  const text = userAgent ?? '';
  return { browser: firstMatch(text, BROWSERS), os: firstMatch(text, SYSTEMS) };
}

/** `user_devices.device_key`: `navegador|sistema`, como `Chrome|macOS`. */
export function deviceKeyFor(userAgent: string | null | undefined): string {
  const { browser, os } = parseUserAgent(userAgent);
  return `${browser ?? UNKNOWN}|${os ?? UNKNOWN}`;
}
