import axe from 'axe-core';
import { expect } from 'vitest';

/*
 * Roda o axe-core no jsdom (regras WCAG A e AA) e falha listando as violações. Contraste fica de
 * fora: o jsdom não calcula cor (o pacote de interface confere a cor de destaque à parte).
 */
export async function expectNoAxeViolations(node: Element = document.body): Promise<void> {
  const result = await axe.run(node, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  const found = result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((item) => item.target.join(' '))
        .join(', ')})`,
  );
  expect(found).toEqual([]);
}
