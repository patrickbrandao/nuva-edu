import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminScope,
  checkImageFile,
  IMAGE_MAX_BYTES,
  ImagePicker,
  type ImagePickerProps,
  PasswordInput,
  type PasswordInputProps,
} from '../../index';
import { expectNoAxeViolations } from '../../test/axe';

function Password(props: Partial<PasswordInputProps>) {
  const [value, setValue] = useState('');
  return (
    <AdminScope>
      <PasswordInput
        label="Senha"
        value={value}
        onChange={setValue}
        autoComplete="new-password"
        showLabel="Mostrar senha"
        hideLabel="Ocultar senha"
        {...props}
      />
    </AdminScope>
  );
}

describe('PasswordInput', () => {
  it('começa oculto, com autocomplete, limites de 8 a 128 e sem violações', async () => {
    render(<Password hint="De 8 a 128 caracteres." />);
    const input = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(input.minLength).toBe(8);
    expect(input.maxLength).toBe(128);
    expect(input.getAttribute('spellcheck')).toBe('false');
    const hint = screen.getByText('De 8 a 128 caracteres.');
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
    await expectNoAxeViolations();
  });

  it('o botão mostra e oculta, e o nome acessível acompanha', () => {
    render(<Password autoComplete="current-password" />);
    const input = screen.getByLabelText('Senha') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-controls')).toBe(input.id);
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toBe(toggle);
    fireEvent.click(toggle);
    expect(input.type).toBe('password');
  });

  it('o contador recebe comprimento e limites e marca quando vale', () => {
    render(<Password counter={({ length, max }) => `${length}/${max}`} />);
    const input = screen.getByLabelText('Senha');
    fireEvent.change(input, { target: { value: 'abc' } });
    const count = screen.getByText('3/128');
    expect(count.getAttribute('data-valid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toContain(count.id);
    fireEvent.change(input, { target: { value: 'abcdefgh' } });
    expect(screen.getByText('8/128').getAttribute('data-valid')).toBe('true');
  });

  it('erro marca aria-invalid e substitui a dica', async () => {
    render(<Password hint="Dica" error="Senha curta demais." />);
    const input = screen.getByLabelText('Senha');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Dica')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Senha curta demais.').id);
    await expectNoAxeViolations();
  });

  it('sem contador nem dica não liga descrição; senha gerada pode começar visível', () => {
    render(<Password defaultVisible />);
    const input = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.type).toBe('text');
  });
});

const PICKER: ImagePickerProps = {
  label: 'Foto de perfil',
  chooseLabel: 'Escolher imagem',
  changeLabel: 'Trocar imagem',
  removeLabel: 'Remover',
  limitHint: 'JPEG, PNG ou WebP, até 5 MB.',
  errors: { tooLarge: 'A imagem passa de 5 MB.', wrongType: 'Use JPEG, PNG ou WebP.' },
  previewAlt: 'Prévia da foto de perfil',
  onChange: () => {},
};

function fileOf(type: string, size: number, name = 'foto'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function choose(file: File) {
  fireEvent.change(screen.getByTestId('image-picker-input'), { target: { files: [file] } });
}

// numa constante, para o Vite não tratar o endereço como um recurso estático
const FORM_CSS_FILE = './form.css';

describe('ImagePicker', () => {
  let created = 0;
  const revoked: string[] = [];
  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    URL.createObjectURL = vi.fn(() => {
      created += 1;
      return `blob:http://localhost/${created}`;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('grupo com nome, limite à vista ligado ao botão e só os três tipos aceitos', async () => {
    render(
      <AdminScope>
        <ImagePicker {...PICKER} placeholder="AS" />
      </AdminScope>,
    );
    expect(screen.getByRole('group', { name: 'Foto de perfil' })).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Escolher imagem' });
    expect(button.getAttribute('aria-describedby')).toBe(
      screen.getByText('JPEG, PNG ou WebP, até 5 MB.').id,
    );
    const input = screen.getByTestId('image-picker-input') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText('AS')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('arquivo aceito vira prévia blob: e é entregue; a troca libera a prévia anterior', async () => {
    const onChange = vi.fn();
    const { unmount } = render(<ImagePicker {...PICKER} onChange={onChange} />);
    const first = fileOf('image/png', 1000);
    choose(first);
    expect(onChange).toHaveBeenCalledWith(first);
    const img = screen.getByRole('img', { name: 'Prévia da foto de perfil' });
    expect(img.getAttribute('src')).toBe('blob:http://localhost/1');
    expect(img.hasAttribute('style')).toBe(false);
    expect(screen.getByRole('button', { name: 'Trocar imagem' })).toBeTruthy();
    choose(fileOf('image/webp', 2000));
    expect(revoked).toEqual(['blob:http://localhost/1']);
    unmount();
    expect(revoked).toEqual(['blob:http://localhost/1', 'blob:http://localhost/2']);
  });

  it('recusa acima de 5 MB e tipo errado no navegador, com a mensagem como alert', async () => {
    const onChange = vi.fn();
    const onReject = vi.fn();
    render(<ImagePicker {...PICKER} onChange={onChange} onReject={onReject} />);
    const big = fileOf('image/jpeg', IMAGE_MAX_BYTES + 1);
    choose(big);
    expect(screen.getByRole('alert').textContent).toBe('A imagem passa de 5 MB.');
    expect(onReject).toHaveBeenCalledWith('too_large', big);
    choose(fileOf('image/gif', 10));
    expect(screen.getByRole('alert').textContent).toBe('Use JPEG, PNG ou WebP.');
    expect(onChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    choose(fileOf('image/jpeg', IMAGE_MAX_BYTES));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });

  it('mostra a imagem atual e remove', () => {
    const onRemove = vi.fn();
    render(<ImagePicker {...PICKER} currentUrl="/imagens/a.webp" onRemove={onRemove} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/imagens/a.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a forma padrão segue redonda; `wide` marca a moldura 16:9 sem `style`, com axe limpo', async () => {
    const { unmount } = render(<ImagePicker {...PICKER} currentUrl="/imagens/a.webp" />);
    const round = screen.getByRole('img').parentElement as HTMLElement;
    expect(round.className).toBe('minui-image-picker__frame');
    expect(round.getAttribute('data-shape')).toBe('round');
    unmount();

    render(
      <AdminScope>
        <ImagePicker
          {...PICKER}
          shape="wide"
          label="Capa do curso"
          previewAlt="Prévia da capa do curso"
        />
      </AdminScope>,
    );
    // sem imagem a moldura larga já existe, com o espaço vazio dentro
    const group = screen.getByRole('group', { name: 'Capa do curso' });
    const empty = group.querySelector('.minui-image-picker__frame') as HTMLElement;
    expect(empty.getAttribute('data-shape')).toBe('wide');
    choose(fileOf('image/webp', 1000, 'capa'));
    const img = screen.getByRole('img', { name: 'Prévia da capa do curso' });
    const frame = img.parentElement as HTMLElement;
    expect(frame.getAttribute('data-shape')).toBe('wide');
    // CSP `style-src 'self'`: a proporção vem do CSS, nunca de `style` em linha
    expect(group.querySelectorAll('[style]')).toHaveLength(0);
    await expectNoAxeViolations();
  });

  it('o CSS dá 16:9 só à forma `wide`; a moldura padrão continua quadrada', () => {
    const css = readFileSync(fileURLToPath(new URL(FORM_CSS_FILE, import.meta.url)), 'utf8');
    const rule = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf('}', start));
    };
    expect(rule('.minui-image-picker__frame')).toContain('aspect-ratio: 1;');
    expect(rule('.minui-image-picker__frame[data-shape="wide"]')).toContain(
      'aspect-ratio: 16 / 9;',
    );
    expect(rule('.minui-image-picker__img')).toContain('object-fit: cover;');
  });

  it('erro de fora tem prioridade e ocupado desabilita os botões', () => {
    render(<ImagePicker {...PICKER} error="O envio falhou." busy />);
    expect(screen.getByRole('alert').textContent).toBe('O envio falhou.');
    expect(screen.getByRole('button', { name: 'Escolher imagem' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('group').getAttribute('aria-busy')).toBe('true');
  });

  it('checkImageFile confere tipo antes do tamanho', () => {
    expect(checkImageFile({ type: 'image/png', size: 10 })).toBeNull();
    expect(checkImageFile({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).toBe('too_large');
    expect(checkImageFile({ type: 'image/svg+xml', size: IMAGE_MAX_BYTES + 1 })).toBe('wrong_type');
  });
});
