/** Aba aberta no clique, à espera do endereço que a API ainda vai devolver. */
export interface PendingTab {
  /** Leva a aba ao endereço (sem aba, por bloqueio de pop-up, navega nesta página). */
  go(url: string): void;
  /** Fecha a aba: o endereço não veio. */
  cancel(): void;
}

/**
 * Navegação de página inteira (sai do site ou vai a uma rota da API que responde `302`, como o
 * login social). Fica num objeto para os testes trocarem: o jsdom não navega.
 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
  /**
   * Abre uma aba em branco durante o clique, para um endereço externo que só chega depois de uma
   * consulta. A aba não guarda referência a esta página (`opener`).
   */
  openTab(): PendingTab {
    const tab = window.open('', '_blank');
    return {
      go(url) {
        if (!tab) {
          window.location.assign(url);
          return;
        }
        tab.opener = null;
        tab.location.replace(url);
      },
      cancel() {
        tab?.close();
      },
    };
  },
  /** Entrega ao navegador, como download, um arquivo que veio pela API (com a sessão). */
  saveFile(file: Blob, name: string): void {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    // o navegador já tem o arquivo; o endereço temporário sai no próximo ciclo
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};

/** Endereço absoluto `http` ou `https` (nada de `javascript:`, `data:` ou caminho relativo). */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
