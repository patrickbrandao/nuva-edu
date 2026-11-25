import { describe, expect, it } from 'vitest';
import i18n from '../i18n/i18n';
import { hasActiveFilters, readFilters, writeFilters } from './filters';
import { formatDuration, isFree, productPath } from './format';

describe('filtros da vitrine no endereço', () => {
  it('lê e escreve os mesmos filtros', () => {
    const filters = {
      type: 'bundle',
      level: 'intermediate',
      price: 'free',
      sort: '-priceCents',
      q: 'git',
    } as const;
    const params = writeFilters(filters);
    expect(params.toString()).toBe(
      'tipo=pacote&nivel=intermediario&preco=gratis&ordem=maior-preco&q=git',
    );
    expect(readFilters(params)).toEqual(filters);
  });

  it('ignora valor desconhecido, apara a busca e a limita a 200 caracteres', () => {
    const params = new URLSearchParams({ tipo: 'plano', ordem: 'x', q: `  ${'a'.repeat(300)} ` });
    const filters = readFilters(params);
    expect(Object.keys(filters)).toEqual(['q']);
    expect(filters.q).toHaveLength(200);
    expect(writeFilters({}).toString()).toBe('');
  });

  it('a ordenação sozinha não conta como filtro ativo', () => {
    expect(hasActiveFilters({ sort: 'title' })).toBe(false);
    expect(hasActiveFilters({ q: 'git' })).toBe(true);
    expect(hasActiveFilters({ price: 'paid' })).toBe(true);
  });
});

describe('formatos do catálogo', () => {
  it('monta o endereço da página de cada tipo', () => {
    expect(productPath('course', 'react-do-zero')).toBe('/cursos/react-do-zero');
    expect(productPath('bundle', 'trilha')).toBe('/pacotes/trilha');
    expect(productPath('ebook', 'guia')).toBe('/ebooks/guia');
  });

  it('formata a duração em horas e minutos', () => {
    expect(formatDuration(i18n.t, 20)).toBe('1 min');
    expect(formatDuration(i18n.t, 600)).toBe('10 min');
    expect(formatDuration(i18n.t, 7200)).toBe('2 h');
    expect(formatDuration(i18n.t, 12000)).toBe('3 h 20 min');
  });

  it('gratuito é modo aberto ou preço zero', () => {
    expect(isFree({ accessMode: 'open', priceCents: null })).toBe(true);
    expect(isFree({ accessMode: 'paid', priceCents: 0 })).toBe(true);
    expect(isFree({ accessMode: 'paid', priceCents: 100 })).toBe(false);
  });
});
