/**
 * Copia do endereço com um parâmetro trocado (ou retirado, com `undefined`), sem tocar nos
 * outros, como a `aba` do editor (spec 006, RF-07).
 */
export function setParam(
  current: URLSearchParams,
  key: string,
  value: string | undefined,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}
