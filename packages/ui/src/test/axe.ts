import axe from 'axe-core';
import { expect } from 'vitest';

/*
 * Roda o axe-core no jsdom e falha listando as violações. Contraste fica de fora: o jsdom
 * não calcula cor (as contas de contraste da cor de destaque têm teste próprio, em
 * src/accent). "region" também: o teste monta o componente solto, sem os marcos da página.
 */
export async function expectNoAxeViolations(node: Element = document.body): Promise<void> {
  const result = await axe.run(node, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  });
  const found = result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((item) => item.target.join(' '))
        .join(', ')})`,
  );
  expect(found).toEqual([]);
}
