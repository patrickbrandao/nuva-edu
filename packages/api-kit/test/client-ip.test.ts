import { describe, expect, it } from 'vitest';
import { createTrustedProxies, normalizeAddress, resolveClientAddress } from '../src/index.ts';

// Padrão da spec 031 (`DEFAULT_TRUSTED_PROXIES` do core).
const DEFAULT = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', 'fc00::/7'];

type Row = [peer: string, xff: string | null, realIp: string | null, ip: string, source: string];

function run(trusted: readonly string[], [peer, xff, realIp, ip, source]: Row) {
  const headers: Record<string, string> = {};
  if (xff !== null) {
    headers['x-forwarded-for'] = xff;
  }
  if (realIp !== null) {
    headers['x-real-ip'] = realIp;
  }
  const result = resolveClientAddress(peer, headers, createTrustedProxies(trusted));
  expect(result).toEqual({ ip, source, peerIp: normalizeAddress(peer) });
}

describe('resolveClientAddress com o padrão de faixas privadas', () => {
  const rows: Row[] = [
    // Conexão direta de fora: cabeçalho forjado não vale (spec 031, critério de aceite).
    ['45.80.10.20', '6.6.6.6', '6.6.6.6', '45.80.10.20', 'tcp'],
    ['172.18.0.5', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    // O cliente controla o começo da lista: vale o mais à direita que não é proxy.
    ['172.18.0.5', '6.6.6.6, 45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['10.0.0.3', null, '45.80.10.20', '45.80.10.20', 'x-real-ip'],
    ['192.168.1.10', 'unknown', '45.80.10.20', '45.80.10.20', 'x-real-ip'],
    ['172.18.0.5', null, null, '172.18.0.5', 'tcp'],
    ['172.18.0.5', '2804:14c::5', null, '2804:14c::5', 'x-forwarded-for'],
    ['::ffff:172.18.0.5', '45.80.10.20:4711', null, '45.80.10.20', 'x-forwarded-for'],
    ['127.0.0.1', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['172.18.0.5', '45.80.10.20, 10.0.0.9', null, '45.80.10.20', 'x-forwarded-for'],
    // Só proxies confiáveis na lista: vale o mais à esquerda.
    ['172.18.0.5', '10.0.0.9', null, '10.0.0.9', 'x-forwarded-for'],
    ['172.18.0.5', '10.0.0.8, 10.0.0.9', null, '10.0.0.8', 'x-forwarded-for'],
    ['fd00::2', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['2804:14c::9', '6.6.6.6', null, '2804:14c::9', 'tcp'],
    ['172.18.0.5', '[2804:14c::5]:443', null, '2804:14c::5', 'x-forwarded-for'],
    // X-Real-IP com lista não é um IP: cai para a conexão.
    ['172.18.0.5', null, '1.1.1.1, 2.2.2.2', '172.18.0.5', 'tcp'],
  ];
  it.each(rows)('peer %s, XFF %s, X-Real-IP %s → %s (%s)', (...row) => run(DEFAULT, row));

  it('junta ocorrências repetidas do X-Forwarded-For', () => {
    const result = resolveClientAddress(
      '172.18.0.5',
      { 'x-forwarded-for': ['6.6.6.6', '45.80.10.20, 10.0.0.9'] },
      createTrustedProxies(DEFAULT),
    );
    expect(result.ip).toBe('45.80.10.20');
  });

  it('considera só as 30 entradas mais à direita', () => {
    const many = Array.from({ length: 40 }, (_, index) => `10.1.0.${index}`).join(', ');
    const result = resolveClientAddress(
      '172.18.0.5',
      { 'x-forwarded-for': many },
      createTrustedProxies(DEFAULT),
    );
    expect(result).toMatchObject({ ip: '10.1.0.10', source: 'x-forwarded-for' });
  });

  it('sem endereço de conexão, não confia em cabeçalho', () => {
    expect(
      resolveClientAddress(
        undefined,
        { 'x-forwarded-for': '6.6.6.6' },
        createTrustedProxies(DEFAULT),
      ),
    ).toEqual({ ip: 'unknown', source: 'tcp', peerIp: 'unknown' });
  });
});

describe('resolveClientAddress com TRUSTED_PROXIES restrito', () => {
  const rows: Row[] = [
    ['172.30.0.2', '45.80.10.20', null, '45.80.10.20', 'x-forwarded-for'],
    ['172.18.0.5', '45.80.10.20', '45.80.10.20', '172.18.0.5', 'tcp'],
    ['172.30.0.2', '45.80.10.20, 10.0.0.9', null, '10.0.0.9', 'x-forwarded-for'],
    ['172.30.0.7', '45.80.10.20', '45.80.10.20', '172.30.0.7', 'tcp'],
  ];
  it.each(rows)('peer %s, XFF %s, X-Real-IP %s → %s (%s)', (...row) => run(['172.30.0.2/32'], row));
});

describe('createTrustedProxies', () => {
  it('aceita IP isolado e faixa, IPv4 e IPv6', () => {
    const trusted = createTrustedProxies([
      '172.30.0.2',
      ' 10.20.0.0/16 ',
      'fd00:1::10',
      'fc00::/7',
    ]);
    expect(trusted.contains('172.30.0.2')).toBe(true);
    expect(trusted.contains('172.30.0.3')).toBe(false);
    expect(trusted.contains('10.20.255.1')).toBe(true);
    expect(trusted.contains('fd00:1::10')).toBe(true);
    expect(trusted.contains('fd12::1')).toBe(true);
    expect(trusted.contains('2804:14c::9')).toBe(false);
    expect(trusted.contains('não é ip')).toBe(false);
  });

  it('lista vazia não confia em ninguém', () => {
    expect(createTrustedProxies([]).contains('127.0.0.1')).toBe(false);
  });

  it.each(['abc', '10.0.0.0/33', 'fc00::/129', '10.0.0.0/8/1', '10.0.0.0/x'])(
    'falha citando a entrada inválida %s',
    (entry) => {
      expect(() => createTrustedProxies(['10.0.0.0/8', entry])).toThrow(entry);
    },
  );
});

describe('normalizeAddress', () => {
  it.each([
    ['1.2.3.4:5555', '1.2.3.4'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['fe80::1%eth0', 'fe80::1'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['  2804:14C::5 ', '2804:14c::5'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeAddress(raw)).toBe(expected);
  });

  it.each(['', 'unknown', 'exemplo.com', '1.2.3', undefined, null, 'a'.repeat(200)])(
    'recusa %s',
    (raw) => {
      expect(normalizeAddress(raw)).toBeNull();
    },
  );
});
