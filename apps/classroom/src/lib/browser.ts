/**
 * Navegação de página inteira (sai do site ou vai a uma rota da API que responde `302`, como o
 * login social). Fica num objeto para os testes trocarem: o jsdom não navega.
 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
