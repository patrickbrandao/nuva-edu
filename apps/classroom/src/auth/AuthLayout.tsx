import { AdminCard } from '@nuva-edu/ui';
import type { ReactNode } from 'react';

/** Coluna estreita das telas de conta (entrar, cadastro, confirmação, redefinição). */
export function AuthLayout({
  title,
  lead,
  children,
  after,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  /** O que vem depois do cartão (ex.: "Ainda não tem conta?"). */
  after?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {lead ? <p className="m-0 text-sm text-ink-3">{lead}</p> : null}
      </header>
      <AdminCard pad>{children}</AdminCard>
      {after}
    </div>
  );
}

/** Classe dos links de texto das telas de conta. */
export const authLinkClass = 'text-ink underline underline-offset-2';

/** Formato mínimo de e-mail conferido no navegador; a API confere o resto. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
