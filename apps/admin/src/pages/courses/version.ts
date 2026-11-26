import { isApiError } from '@nuva-edu/api-client/admin';
import { useCallback, useState } from 'react';

/*
 * Edição com `version` no catálogo (spec 009, "Criação e edição"): cada escrita leva o `version`
 * da última resposta do item; diferente do gravado, a API responde `409` `version_conflict` sem
 * gravar. O site avisa, guarda o que foi digitado e oferece recarregar; não reenvia sozinho.
 */

/** `409` `version_conflict`: outra pessoa gravou o item no meio da edição. */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === 'version_conflict';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Leva o formulário para uma versão nova do item sem perder o que foi digitado: o campo que a
 * pessoa não mexeu (igual ao da versão anterior) passa a mostrar o valor novo; o que ela mexeu
 * fica como está.
 */
export function rebase<S extends object>(edited: S, before: S, after: S): S {
  const next = { ...edited };
  for (const key of Object.keys(after) as (keyof S)[]) {
    if (same(edited[key], before[key])) next[key] = after[key];
  }
  return next;
}

/**
 * Estado de um formulário que nasce de um item do cache. Quando o item muda (gravação, ação,
 * "Recarregar" depois de um conflito), o formulário segue a versão nova pelo `rebase`.
 */
export function useEditedForm<R, S extends object>(source: R, toForm: (source: R) => S) {
  const [state, setState] = useState(() => ({ base: source, form: toForm(source) }));
  let current = state;
  if (state.base !== source) {
    current = { base: source, form: rebase(state.form, toForm(state.base), toForm(source)) };
    setState(current);
  }
  const setForm = useCallback(
    (update: S | ((form: S) => S)) =>
      setState((previous) => ({
        ...previous,
        form: typeof update === 'function' ? update(previous.form) : update,
      })),
    [],
  );
  return [current.form, setForm] as const;
}
