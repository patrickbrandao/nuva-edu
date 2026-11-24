import type { AnchorHTMLAttributes, ComponentType, ReactNode, Ref } from 'react';
import { createContext, useContext } from 'react';

/*
 * Componente de link dos sites.
 *
 * Os componentes do pacote desenham `<a href>`; um site com roteador passa aqui o seu
 * componente de link, e a navegação interna deixa de recarregar a página. O pacote não
 * conhece roteador nenhum: recebe um componente que aceita `href` e as demais
 * propriedades de `<a>`.
 *
 *   const RouterLink: LinkComponent = ({ href, ...rest }) => <Link to={href} {...rest} />;
 *   <LinkProvider component={RouterLink}>...</LinkProvider>
 *
 * Cada componente também aceita `linkComponent`, que vale mais que o do provedor.
 */

/** O que o componente de link recebe: as propriedades de `<a>`, com `href` obrigatório. */
export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  ref?: Ref<HTMLAnchorElement> | undefined;
};

/** Componente de link do roteador do site, ou `'a'` para o link comum. */
export type LinkComponent = ComponentType<LinkProps> | 'a';

const LinkContext = createContext<LinkComponent>('a');

export interface LinkProviderProps {
  /** Componente usado nos links internos de tudo o que estiver dentro. */
  component: LinkComponent;
  children?: ReactNode;
}

/** Define o componente de link para todos os componentes do pacote que estiverem dentro. */
export function LinkProvider({ component, children }: LinkProviderProps) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

/** Endereço interno do site: começa com uma só barra (`/cursos`, não `//host` nem `https:`). */
export function isInternalHref(href: string | undefined): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

export interface LinkTarget {
  href?: string | undefined;
  target?: string | undefined;
  download?: unknown;
}

/**
 * Escolhe a tag de um link: o componente do site para endereço interno aberto na mesma
 * aba; `<a>` comum para endereço externo, `target` diferente de `_self` e `download`.
 */
export function useLinkComponent(
  override?: LinkComponent | null,
  link: LinkTarget = {},
): LinkComponent {
  const fromContext = useContext(LinkContext);
  const component = override ?? fromContext;
  if (link.href !== undefined && !isInternalHref(link.href)) return 'a';
  if (link.target && link.target !== '_self') return 'a';
  if (link.download !== undefined && link.download !== false) return 'a';
  return component;
}
