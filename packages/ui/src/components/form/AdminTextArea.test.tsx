import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AdminScope, AdminTextArea, type AdminTextAreaProps } from '../../index';
import { expectNoAxeViolations } from '../../test/axe';

function Area(props: Partial<AdminTextAreaProps> & { initial?: string }) {
  const { initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <AdminScope>
      <AdminTextArea label="Motivo" value={value} onChange={setValue} {...rest} />
    </AdminScope>
  );
}

describe('AdminTextArea', () => {
  it('textarea com rótulo, linhas, limite e dica ligada, sem violações', async () => {
    render(<Area hint="Até 500 caracteres." rows={3} maxLength={500} />);
    const area = screen.getByLabelText('Motivo') as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.rows).toBe(3);
    expect(area.maxLength).toBe(500);
    expect(area.hasAttribute('aria-invalid')).toBe(false);
    expect(area.getAttribute('aria-describedby')).toBe(screen.getByText('Até 500 caracteres.').id);
    expect(area.closest('.minui-adm-field')).not.toBeNull();
    expect(area.parentElement?.classList.contains('minui-adm-input')).toBe(true);
    await expectNoAxeViolations();
  });

  it('padrão de 4 linhas, sem limite e sem descrição', () => {
    render(<Area label="Texto (Markdown)" />);
    const area = screen.getByLabelText('Texto (Markdown)') as HTMLTextAreaElement;
    expect(area.rows).toBe(4);
    expect(area.hasAttribute('maxlength')).toBe(false);
    expect(area.hasAttribute('aria-describedby')).toBe(false);
  });

  it('onChange recebe o texto, com quebras de linha', () => {
    render(<Area />);
    const area = screen.getByLabelText('Motivo') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'linha 1\nlinha 2' } });
    expect(area.value).toBe('linha 1\nlinha 2');
  });

  it('erro marca aria-invalid, borda de erro e substitui a dica', async () => {
    render(<Area hint="Dica" error="Campo obrigatório." />);
    const area = screen.getByLabelText('Motivo');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Dica')).toBeNull();
    expect(area.getAttribute('aria-describedby')).toBe(screen.getByText('Campo obrigatório.').id);
    expect(area.closest('.minui-adm-field--error')).not.toBeNull();
    await expectNoAxeViolations();
  });

  it('o contador recebe comprimento, limite e restante, e entra na descrição', async () => {
    render(
      <Area
        hint="Dica"
        maxLength={10}
        counter={({ length, max, remaining }) => `${length}/${max} (faltam ${remaining})`}
      />,
    );
    const area = screen.getByLabelText('Motivo');
    fireEvent.change(area, { target: { value: 'abc' } });
    const count = screen.getByText('3/10 (faltam 7)');
    expect(count.getAttribute('data-valid')).toBe('true');
    const described = area.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described).toEqual([screen.getByText('Dica').id, count.id]);
    await expectNoAxeViolations();
  });

  it('valor acima do limite (vindo de fora) marca o contador como inválido', () => {
    render(
      <Area initial="abcdef" maxLength={5} counter={({ length, valid }) => `${length} ${valid}`} />,
    );
    const count = screen.getByText('6 false');
    expect(count.getAttribute('data-valid')).toBe('false');
  });

  it('contador sem limite recebe max e remaining indefinidos', () => {
    render(<Area counter={({ length, max, remaining }) => `${length}|${max}|${remaining}`} />);
    expect(screen.getByText('0|undefined|undefined')).not.toBeNull();
  });

  it('repassa id, name, required e disabled', () => {
    render(<Area id="motivo" name="reason" required disabled />);
    const area = screen.getByLabelText('Motivo') as HTMLTextAreaElement;
    expect(area.id).toBe('motivo');
    expect(area.name).toBe('reason');
    expect(area.required).toBe(true);
    expect(area.disabled).toBe(true);
  });
});
