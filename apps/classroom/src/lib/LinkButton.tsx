import { AdminButton } from '@nuva-edu/ui';
import type { ComponentProps } from 'react';
import { useHref, useLinkClickHandler } from 'react-router';

type LinkButtonProps = Omit<ComponentProps<typeof AdminButton>, 'href' | 'onClick'> & {
  /** Rota interna do site. */
  to: string;
};

/**
 * Botão de @nuva-edu/ui que navega pelo roteador. O `AdminButton` desenha um `<a href>`
 * simples; aqui o clique passa pelo React Router, sem recarregar a página (clique com tecla
 * modificadora e botão do meio seguem o navegador).
 */
export function LinkButton({ to, ...props }: LinkButtonProps) {
  const href = useHref(to);
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to);
  return <AdminButton {...props} href={href} onClick={onClick} />;
}
