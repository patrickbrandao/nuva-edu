import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminScope,
  Alert,
  ConfirmDialog,
  Dialog,
  Toast,
  ToastProvider,
  useToast,
} from '../../index';
import { expectNoAxeViolations } from '../../test/axe';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Editar curso"
        description="Mude o nome e salve."
        closeLabel="Fechar"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="button">Salvar</button>
          </>
        }
      >
        <label>
          Nome
          <input defaultValue="SQL" />
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('abre com nome, descrição, aria-modal e o foco no primeiro campo', async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Editar curso' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Mude o nome e salve.').id).toBe(
      dialog.getAttribute('aria-describedby'),
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
    expect(document.documentElement.classList.contains('minui-scroll-locked')).toBe(true);
    await expectNoAxeViolations();
  });

  it('Esc fecha e o foco volta ao gatilho', () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.classList.contains('minui-scroll-locked')).toBe(false);
  });

  it('prende o foco: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Fechar' });
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('foco que sai do diálogo volta para dentro', () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    fireEvent.click(opener);
    act(() => opener.focus());
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('clique no fundo e no "x" pedem para fechar; não dispensável ignora Esc e fundo', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} title="Aviso" closeLabel="Fechar">
        <p>Corpo</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <Dialog open onClose={onClose} title="Aviso" closeLabel="Fechar" dismissible={false}>
        <p>Corpo</p>
      </Dialog>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('com dois abertos, Esc fecha só o de cima', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onClose={outer} title="Fora">
          <button type="button">Um</button>
        </Dialog>
        <Dialog open onClose={inner} title="Dentro">
          <button type="button">Dois</button>
        </Dialog>
      </>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('fechado não desenha nada', () => {
    render(<Dialog open={false} onClose={() => {}} title="Nada" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  const base = {
    open: true,
    title: 'Excluir o curso?',
    itemName: 'SQL do zero',
    message: 'Os alunos perdem o acesso.',
    confirmLabel: 'Excluir',
    cancelLabel: 'Cancelar',
  };

  it('é um alertdialog com o nome do item, foco em cancelar e botão destrutivo', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir o curso?' });
    expect(within(dialog).getByText('SQL do zero').tagName).toBe('STRONG');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    const confirm = within(dialog).getByRole('button', { name: 'Excluir' });
    expect(confirm.className).toContain('minui-adm-btn--danger');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });

  it('com digitação, só libera quando o nome confere', () => {
    render(
      <ConfirmDialog
        {...base}
        onConfirm={() => {}}
        onCancel={() => {}}
        typeToConfirmLabel="Digite o nome do curso"
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Excluir' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Digite o nome do curso'), {
      target: { value: 'SQL do zero' },
    });
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('em andamento desabilita os botões, troca o texto e não fecha com Esc', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        {...base}
        destructive={false}
        busy
        busyLabel="Excluindo…"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Excluindo…' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(confirm.className).not.toContain('minui-adm-btn--danger');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

function ToastButtons() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success('Perfil salvo.')}>
        sucesso
      </button>
      <button
        type="button"
        onClick={() => toast.error('Não foi possível salvar.', { title: 'Erro' })}
      >
        erro
      </button>
      <button
        type="button"
        onClick={() =>
          toast.warning('Sessão quase expirando.', {
            id: 'sessao',
            action: { label: 'Continuar', onClick: () => {} },
          })
        }
      >
        aviso
      </button>
    </>
  );
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('as regiões vivas existem antes do primeiro aviso', async () => {
    render(
      <ToastProvider dismissLabel="Dispensar" regionLabel="Avisos">
        <ToastButtons />
      </ToastProvider>,
    );
    const region = screen.getByRole('region', { name: 'Avisos' });
    expect(within(region).getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(within(region).getByRole('alert')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('sucesso vai para status e some sozinho; erro vai para alert e fica', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider dismissLabel="Dispensar" regionLabel="Avisos" duration={3000}>
        <ToastButtons />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    fireEvent.click(screen.getByRole('button', { name: 'erro' }));
    expect(within(screen.getByRole('status')).getByText('Perfil salvo.')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Não foi possível salvar.')).toBeTruthy();
    expect(within(alert).getByText('Erro')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText('Perfil salvo.')).toBeNull();
    expect(screen.getByText('Não foi possível salvar.')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByText('Não foi possível salvar.')).toBeNull();
  });

  it('o tempo para com o ponteiro sobre os avisos', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider dismissLabel="Dispensar" regionLabel="Avisos" duration={1000}>
        <ToastButtons />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    fireEvent.pointerEnter(screen.getByRole('region', { name: 'Avisos' }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Perfil salvo.')).toBeTruthy();
    fireEvent.pointerLeave(screen.getByRole('region', { name: 'Avisos' }));
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText('Perfil salvo.')).toBeNull();
  });

  it('o mesmo id substitui; a ação dispara e dispensa', () => {
    render(
      <ToastProvider dismissLabel="Dispensar" regionLabel="Avisos">
        <ToastButtons />
      </ToastProvider>,
    );
    const warn = screen.getByRole('button', { name: 'aviso' });
    fireEvent.click(warn);
    fireEvent.click(warn);
    expect(screen.getAllByText('Sessão quase expirando.')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByText('Sessão quase expirando.')).toBeNull();
  });

  it('useToast fora do provedor avisa o erro de uso', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ToastButtons />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });

  it('Toast solto desenha o tom, o título e o "x" com nome', async () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <AdminScope>
        <Toast
          tone="warning"
          title="Atenção"
          message="Confira os dados."
          onDismiss={onDismiss}
          dismissLabel="Dispensar"
        />
      </AdminScope>,
    );
    expect(container.querySelector('.minui-toast')?.getAttribute('data-tone')).toBe('warning');
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });
});

describe('Alert', () => {
  it('erro é alert; os outros tons são status; role null tira o papel', async () => {
    const { rerender } = render(
      <Alert tone="error" title="Falhou">
        Tente de novo.
      </Alert>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Falhou');
    rerender(<Alert tone="warning">Termos novos publicados.</Alert>);
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warning');
    rerender(
      // biome-ignore lint/a11y/useValidAriaRole: `role` aqui é a propriedade do Alert
      <Alert tone="info" role={null}>
        Sem papel.
      </Alert>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    await expectNoAxeViolations();
  });

  it('faixa com ações e "x" com nome acessível', async () => {
    const onDismiss = vi.fn();
    render(
      <AdminScope>
        <Alert
          tone="warning"
          layout="banner"
          title="Há termos novos"
          actions={<a href="/termos">Ver termos</a>}
          onDismiss={onDismiss}
          dismissLabel="Fechar aviso"
        >
          Publique ou revise antes do lançamento.
        </Alert>
      </AdminScope>,
    );
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('data-layout')).toBe('banner');
    expect(within(banner).getByRole('link', { name: 'Ver termos' })).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Fechar aviso' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });
});
