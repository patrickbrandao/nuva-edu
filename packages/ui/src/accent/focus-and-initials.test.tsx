import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AdminAvatar,
  AdminSidebar,
  ClassroomShell,
  contrastRatio,
  hueOf,
  ThemeSwitch,
} from '../index';
import { fakeViewport } from '../test/viewport';
import { hslToHex } from './accent';

// em constantes, para o Vite não tratar os endereços como recursos estáticos
const THEME_FILE = '../theme/theme.css';
const ADMIN_FILE = '../components/admin/admin.css';
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

/** O corpo da primeira regra cujo seletor é exatamente `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `regra ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

const LABELS = {
  skipToContent: 'Ir para o conteúdo',
  menu: 'Menu principal',
  openMenu: 'Abrir o menu',
  closeMenu: 'Fechar o menu',
  collapseMenu: 'Recolher o menu',
  expandMenu: 'Expandir o menu',
  breadcrumb: 'Você está em',
};

describe('anel de foco do ThemeSwitch', () => {
  const theme = read(THEME_FILE);
  const admin = read(ADMIN_FILE);

  it('usa o token dos botões e links (--minui-accent-text), nos dois temas', () => {
    // botões e links: .minui-adm :focus-visible pinta com --adm-focus, que é --minui-accent-text
    expect(rule(admin, '.minui-adm :focus-visible')).toContain(
      'outline: 2px solid var(--adm-focus)',
    );
    expect(admin).toContain('--adm-focus: var(--minui-accent-text, var(--minui-focus-ring));');
    // o token já é light-dark por dentro: uma regra só vale para os dois temas
    const focus = rule(theme, '.minui-theme button:focus-visible');
    expect(focus).toContain('outline: 2px solid var(--minui-accent-text, var(--minui-blue));');
    expect(theme.match(/--minui-blue/g)).toHaveLength(1);
  });

  it('os botões do seletor são <button> dentro de .minui-theme, alvo da regra', () => {
    render(<ThemeSwitch mode="system" onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Tema escuro' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.closest('.minui-theme')).not.toBeNull();
  });
});

describe('hslToHex', () => {
  it('converte as cores de referência', () => {
    expect(hslToHex(0, 0, 0)).toBe('#000000');
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    expect(hslToHex(-120, 100, 50)).toBe('#0000ff');
    // a medida da tarefa 110: hsl(89 62% 46%) é rgb(120, 190, 45)
    expect(hslToHex(89, 62, 46)).toBe('#78be2d');
  });
});

describe('iniciais do AdminAvatar', () => {
  const avatarOf = (container: HTMLElement) =>
    container.querySelector('.minui-adm-avatar') as HTMLElement;
  const varOf = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);

  it('texto branco ou preto com 4,5:1 sobre a cor derivada do nome, em todos os matizes', () => {
    const seen = new Set<string>();
    for (let index = 0; seen.size < 360 && index < 20000; index += 1) {
      const name = `Escola ${index}`;
      const hue = hueOf(name);
      if (seen.has(String(hue))) continue;
      seen.add(String(hue));
      const { container, unmount } = render(<AdminAvatar name={name} />);
      const avatar = avatarOf(container);
      expect(varOf(avatar, '--adm-av-bg')).toBe(`hsl(${hue} 62% 46%)`);
      const on = varOf(avatar, '--adm-av-on');
      expect(['#ffffff', '#000000']).toContain(on);
      expect(contrastRatio(on, hslToHex(hue, 62, 46)), name).toBeGreaterThanOrEqual(4.5);
      unmount();
    }
    expect(seen.size).toBe(360);
  });

  it('o caso medido (verde de matiz 89) deixa de ser branco sobre verde', () => {
    // branco dava perto de 2,3:1
    expect(contrastRatio('#ffffff', '#78be2d')).toBeLessThan(3);
    let name = '';
    for (let index = 0; hueOf(name) !== 89; index += 1) name = `Escola ${index}`;
    const { container } = render(<AdminAvatar square name={name} />);
    expect(varOf(avatarOf(container), '--adm-av-on')).toBe('#000000');
  });

  it('com `color` em #RRGGBB mede a cor dada; fora do formato, mantém o branco do CSS', () => {
    const light = render(<AdminAvatar name="Ana" color="#ffd166" />);
    expect(varOf(avatarOf(light.container), '--adm-av-on')).toBe('#000000');
    const dark = render(<AdminAvatar name="Ana" color="#1e3a5f" />);
    expect(varOf(avatarOf(dark.container), '--adm-av-on')).toBe('#ffffff');
    const token = render(<AdminAvatar name="Ana" color="var(--adm-blue)" />);
    expect(varOf(avatarOf(token.container), '--adm-av-on')).toBe('');
    expect(rule(read(ADMIN_FILE), '.minui-adm-avatar')).toContain(
      'color: var(--adm-av-on, #ffffff);',
    );
  });

  it('`soft` e foto não recebem cor de texto calculada nem a variante da marca', () => {
    const soft = render(<AdminAvatar soft accent name="Ana" />);
    expect(varOf(avatarOf(soft.container), '--adm-av-on')).toBe('');
    expect(avatarOf(soft.container).className).not.toContain('minui-adm-avatar--accent');
    const photo = render(<AdminAvatar accent name="Ana" src="/ana.png" />);
    expect(varOf(avatarOf(photo.container), '--adm-av-on')).toBe('');
    expect(avatarOf(photo.container).className).not.toContain('minui-adm-avatar--accent');
  });

  it('`accent`: fundo e texto da cor de destaque; sem ela, a cor do nome com o texto medido', () => {
    const { container } = render(<AdminAvatar square accent name="Escola Aurora" />);
    const avatar = avatarOf(container);
    expect(avatar.className).toContain('minui-adm-avatar--accent');
    // os valores de reserva continuam no elemento, para quando --minui-accent não existe
    expect(varOf(avatar, '--adm-av-bg')).toBe(`hsl(${hueOf('Escola Aurora')} 62% 46%)`);
    expect(varOf(avatar, '--adm-av-on')).not.toBe('');
    const css = rule(read(ADMIN_FILE), '.minui-adm-avatar--accent');
    expect(css).toContain(
      'background: var(--minui-accent-fill, var(--adm-av-bg, var(--adm-active)));',
    );
    expect(css).toContain('color: var(--minui-accent-on, var(--adm-av-on, #ffffff));');
    // a variante vem depois da regra base, e a `soft` depois dela
    const sheet = read(ADMIN_FILE);
    expect(sheet.indexOf('\n.minui-adm-avatar--accent {')).toBeGreaterThan(
      sheet.indexOf('\n.minui-adm-avatar {'),
    );
    expect(sheet.indexOf('\n.minui-adm-avatar--soft {')).toBeGreaterThan(
      sheet.indexOf('\n.minui-adm-avatar--accent {'),
    );
  });
});

describe('marca das cascas', () => {
  it('ClassroomShell sem logotipo: iniciais na variante da cor de destaque, decorativas', () => {
    fakeViewport(1280);
    const { container } = render(
      <ClassroomShell brand={{ name: 'Escola Aurora', href: '/' }} groups={[]} labels={LABELS}>
        <p>Conteúdo</p>
      </ClassroomShell>,
    );
    const mark = container.querySelector('.minui-room__brand-mark') as HTMLElement;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    const avatar = mark.querySelector('.minui-adm-avatar') as HTMLElement;
    expect(avatar.className).toContain('minui-adm-avatar--square');
    expect(avatar.className).toContain('minui-adm-avatar--accent');
    expect(avatar.textContent).toBe('E');
    expect(['#ffffff', '#000000']).toContain(avatar.style.getPropertyValue('--adm-av-on'));
  });

  it('ClassroomShell com logotipo não desenha as iniciais', () => {
    fakeViewport(1280);
    const { container } = render(
      <ClassroomShell
        brand={{ name: 'Escola Aurora', href: '/', mark: <img src="/logo.png" alt="" /> }}
        groups={[]}
        labels={LABELS}
      >
        <p>Conteúdo</p>
      </ClassroomShell>,
    );
    expect(container.querySelector('.minui-room__brand-mark .minui-adm-avatar')).toBeNull();
  });

  it('AdminSidebar: o avatar do usuário segue a cor do nome, com o texto medido', () => {
    const { container } = render(
      <AdminSidebar
        brand={{ name: 'Escola Aurora' }}
        sections={[]}
        user={{ name: 'Rita Alves' }}
      />,
    );
    const avatar = container.querySelector('.minui-adm-user .minui-adm-avatar') as HTMLElement;
    expect(avatar.className).not.toContain('minui-adm-avatar--accent');
    const on = avatar.style.getPropertyValue('--adm-av-on');
    expect(contrastRatio(on, hslToHex(hueOf('Rita Alves'), 62, 46))).toBeGreaterThanOrEqual(4.5);
  });
});
