import axe from 'axe-core';
import { expect } from 'vitest';

/*
 * Roda o axe-core (regras WCAG 2.0/2.1 A e AA) no jsdom e falha listando as violações. Contraste
 * fica de fora: o jsdom não calcula cor (as contas de contraste estão em @nuva-edu/ui).
 */
export async function expectNoAxeViolations(node: Element = document.body): Promise<void> {
  const result = await axe.run(node, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
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
