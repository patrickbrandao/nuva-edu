/**
 * Navegação de página inteira, fora do roteador: o login social precisa sair do site até o
 * provedor (spec 007, "Fluxo do provedor"). Fica num objeto para os testes a observarem.
 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
