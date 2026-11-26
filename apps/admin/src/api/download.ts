/**
 * Entrega ao navegador, como download, um arquivo já lido da API. O admin não abre o arquivo em
 * `iframe` (a CSP dele não tem `frame-src`): o PDF é sempre baixado.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // o download já começou: o endereço temporário pode ser liberado
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
