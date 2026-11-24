import { BlockList, isIP } from 'node:net';

export type ClientIpSource = 'x-forwarded-for' | 'x-real-ip' | 'tcp';

export interface ClientAddress {
  /** IP do cliente deduzido: use este em limite de taxa, auditoria e logs. */
  ip: string;
  /** De onde o `ip` saiu. */
  source: ClientIpSource;
  /** IP da conexão TCP: o proxy que entregou a requisição, ou o próprio cliente. */
  peerIp: string;
}

export interface TrustedProxies {
  /** Prefixos efetivos, como recebidos. */
  readonly entries: readonly string[];
  /** Verdadeiro se o endereço (já normalizado) pertence a um proxy confiável. */
  contains(address: string): boolean;
}

/** Limites contra abuso do `X-Forwarded-For`: só o trecho mais à direita é considerado. */
const MAX_XFF_LENGTH = 2048;
const MAX_XFF_ENTRIES = 30;

/**
 * Monta o conjunto de proxies confiáveis a partir de `config.trustedProxies` (IPs e faixas
 * CIDR, IPv4 e IPv6). Entrada inválida lança: a subida do serviço falha citando a entrada.
 */
export function createTrustedProxies(entries: readonly string[]): TrustedProxies {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix, ...rest] = entry.trim().split('/');
    const family = isIP(address);
    const bits = prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix);
    if (
      family === 0 ||
      rest.length > 0 ||
      (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) ||
      bits > (family === 4 ? 32 : 128)
    ) {
      throw new TypeError(`TRUSTED_PROXIES inválido: "${entry}" não é um IP nem uma faixa CIDR.`);
    }
    list.addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6');
  }
  return {
    entries: [...entries],
    contains(address) {
      const family = isIP(address);
      return family !== 0 && list.check(address, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}

/**
 * Normaliza um endereço: tira porta (`1.2.3.4:5555`, `[2001:db8::1]:443`), zona IPv6 (`%eth0`)
 * e o prefixo de IPv4 mapeado (`::ffff:1.2.3.4`). Devolve `null` se não for um IP literal.
 */
export function normalizeAddress(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  let value = raw.trim();
  if (value === '' || value.length > 100) {
    return null;
  }
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) {
    value = bracketed[1];
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  const zone = value.indexOf('%');
  if (zone !== -1) {
    value = value.slice(0, zone);
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped?.[1] !== undefined) {
    value = mapped[1];
  }
  return isIP(value) === 0 ? null : value.toLowerCase();
}

type HeaderValue = string | readonly string[] | undefined;

/**
 * IP real do cliente (spec 031). Os cabeçalhos só valem quando a conexão TCP vem de um proxy
 * confiável; do `X-Forwarded-For` vale o endereço mais à direita que não é proxy confiável;
 * `X-Real-IP` é a alternativa quando o `X-Forwarded-For` falta ou é inválido.
 */
export function resolveClientAddress(
  remoteAddress: string | undefined,
  headers: Readonly<Record<string, HeaderValue>>,
  trusted: TrustedProxies,
): ClientAddress {
  const peerIp = normalizeAddress(remoteAddress) ?? 'unknown';
  const fromTcp: ClientAddress = { ip: peerIp, source: 'tcp', peerIp };
  if (!trusted.contains(peerIp)) {
    return fromTcp;
  }

  const forwarded = joinHeader(headers['x-forwarded-for']);
  if (forwarded !== '') {
    const hops = forwarded.slice(-MAX_XFF_LENGTH).split(',').slice(-MAX_XFF_ENTRIES);
    let leftmost: string | null = null;
    let valid = true;
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const ip = normalizeAddress(hops[i]);
      if (ip === null) {
        valid = false;
        break;
      }
      if (!trusted.contains(ip)) {
        return { ip, source: 'x-forwarded-for', peerIp };
      }
      leftmost = ip;
    }
    // Só proxies confiáveis na lista: vale o mais à esquerda.
    if (valid && leftmost !== null) {
      return { ip: leftmost, source: 'x-forwarded-for', peerIp };
    }
  }

  const realIpHeader = headers['x-real-ip'];
  const realIp = normalizeAddress(
    typeof realIpHeader === 'string' ? realIpHeader : realIpHeader?.[0],
  );
  if (realIp !== null) {
    return { ip: realIp, source: 'x-real-ip', peerIp };
  }
  return fromTcp;
}

function joinHeader(value: HeaderValue): string {
  return (typeof value === 'string' ? value : (value ?? []).join(',')).trim();
}
