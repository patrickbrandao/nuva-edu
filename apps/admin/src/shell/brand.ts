import { DEFAULT_SOURCE_CODE_URL } from '../config';

/**
 * Variável CSS da cor de destaque da escola, definida no `<html>`. Os componentes de
 * `@nuva-edu/ui` passam a lê-la com a tarefa 094; sem ela, vale a cor padrão do pacote.
 */
export const ACCENT_CSS_VARIABLE = '--minui-accent';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A cor de destaque do `/meta` se estiver no formato `#RRGGBB`; senão, `null` (cor padrão). */
export function validAccentColor(value: string | null | undefined): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : null;
}

/**
 * Endereço do link "Código-fonte" (spec 006, RF-11): o `sourceCodeUrl` do `/meta` quando é um
 * endereço `http(s)`; enquanto o `/meta` carrega, falha ou traz outra coisa, o repositório padrão.
 */
export function sourceCodeUrlOf(value: string | null | undefined): string {
  if (typeof value !== 'string') return DEFAULT_SOURCE_CODE_URL;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : DEFAULT_SOURCE_CODE_URL;
  } catch {
    return DEFAULT_SOURCE_CODE_URL;
  }
}
