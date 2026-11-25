import * as ui from '@nuva-edu/ui';
import { describe, expect, it } from 'vitest';

describe('ponto de entrada do pacote', () => {
  it('é importável pelo nome do pacote e exporta as peças que as specs citam', () => {
    const expected = [
      'Surface',
      'Txt',
      'Avatar',
      'Badge',
      'Dot',
      'Field',
      'LabelPill',
      'ActionButton',
      'AdminShell',
      'AdminSidebar',
      'AdminTopbar',
      'AdminButton',
      'AdminTable',
      'CasesBoard',
      'ClientOverview',
      'PricingPage',
      'ThemeSwitch',
      'useTheme',
      'Dialog',
      'ConfirmDialog',
      'Toast',
      'ToastProvider',
      'useToast',
      'PasswordInput',
      'AdminTextArea',
      'ImagePicker',
      'Alert',
      'Markdown',
      'SortableList',
      'Accordion',
      'Tabs',
      'ProgressBar',
      'ProductCard',
      'ProductCardList',
    ];
    for (const name of expected) expect(ui, name).toHaveProperty(name);
  });

  it('não traz as peças de vitrine do minui que o produto não usa', () => {
    for (const name of ['Stage', 'Sprite', 'LiveScene', 'Keycap', 'AgentSessionView', 'AppIcon']) {
      expect(ui, name).not.toHaveProperty(name);
    }
  });
});
