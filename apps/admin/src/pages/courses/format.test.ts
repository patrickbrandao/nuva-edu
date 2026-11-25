import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatPrice,
  isContentUrl,
  parseDuration,
  parsePrice,
  parseWhole,
  priceInput,
} from './format';

describe('duração da aula', () => {
  it('mostra minutos e segundos, e horas quando passa de uma', () => {
    expect(formatDuration(754)).toBe('12:34');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3930)).toBe('1:05:30');
    expect(formatDuration(null)).toBe('');
  });

  it('lê mm:ss, h:mm:ss e só minutos; vazio é sem duração', () => {
    expect(parseDuration('12:34')).toBe(754);
    expect(parseDuration('1:05:30')).toBe(3930);
    expect(parseDuration('12')).toBe(720);
    expect(parseDuration('  ')).toBeNull();
  });

  it('recusa texto fora do formato', () => {
    expect(parseDuration('doze')).toBeUndefined();
    expect(parseDuration('12:99')).toBeUndefined();
    expect(parseDuration('1:2:3:4')).toBeUndefined();
    expect(parseDuration('-5')).toBeUndefined();
  });
});

describe('preço', () => {
  it('lê o valor em reais e devolve centavos', () => {
    expect(parsePrice('49,90')).toBe(4990);
    expect(parsePrice('49.90')).toBe(4990);
    expect(parsePrice('49')).toBe(4900);
    expect(parsePrice('1.234,56')).toBe(123456);
    expect(parsePrice('0')).toBe(0);
    expect(parsePrice('')).toBeNull();
  });

  it('recusa valor fora do formato', () => {
    expect(parsePrice('abc')).toBeUndefined();
    expect(parsePrice('-1')).toBeUndefined();
    expect(parsePrice('1,999')).toBeUndefined();
  });

  it('mostra os centavos no campo e na moeda da escola', () => {
    expect(priceInput(4990)).toBe('49,90');
    expect(priceInput(null)).toBe('');
    expect(formatPrice(4990, 'BRL').replace(/\s/g, ' ')).toBe('R$ 49,90');
  });
});

describe('inteiro de um campo', () => {
  it('aceita a faixa, devolve nulo no vazio e recusa o resto', () => {
    expect(parseWhole('30', 1, 36500)).toBe(30);
    expect(parseWhole('', 1, 36500)).toBeNull();
    expect(parseWhole('0', 1, 36500)).toBeUndefined();
    expect(parseWhole('36501', 1, 36500)).toBeUndefined();
    expect(parseWhole('1,5', 1, 36500)).toBeUndefined();
  });
});

describe('URL de conteúdo (spec 009)', () => {
  it('aceita https e http só em localhost', () => {
    expect(isContentUrl('https://youtu.be/abc')).toBe(true);
    expect(isContentUrl('http://videos.localhost/aula.mp4')).toBe(true);
    expect(isContentUrl('http://exemplo.com/aula.mp4')).toBe(false);
  });

  it('recusa credenciais, espaços, texto solto e mais de 2.000 caracteres', () => {
    expect(isContentUrl('https://ana:senha@exemplo.com/a')).toBe(false);
    expect(isContentUrl('https://exemplo.com/a b')).toBe(false);
    expect(isContentUrl('aula-1')).toBe(false);
    expect(isContentUrl(`https://exemplo.com/${'a'.repeat(2000)}`)).toBe(false);
  });
});
