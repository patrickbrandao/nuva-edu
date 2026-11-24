/**
 * O valor como sai no fio: `Date` vira texto ISO 8601 em UTC, `undefined` some. A validação de
 * resposta confere o corpo antes da serialização, então as rotas devolvem já neste formato o que
 * vem do núcleo com datas.
 */
export function toWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}
