import { PanelLeft, X } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './shell.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { AdminAvatar as RawAdminAvatar } from '../admin/AdminData.jsx';
import { AdminBreadcrumb as RawAdminBreadcrumb } from '../admin/AdminShell.jsx';
import { TextLink } from '../flow/flow';
import { type LinkComponent, useLinkComponent } from '../link/link';
import { useDrawerFocus, useNarrowViewport } from './drawer';

/*
 * Casca do site do aluno (spec 006): barra superior, menu lateral, trilha, conteúdo e
 * rodapé. Migrada de apps/classroom/src/shell e generalizada: os textos vêm por props,
 * o roteador entra pelo componente de link e o pacote não conhece i18n nem a API.
 *
 * O menu é uma coluna fixa que recolhe para os ícones; abaixo de `drawerBelow` px de
 * tela (1024, spec 006 RNF-01) vira uma gaveta sobre a página.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminAvatar = RawAdminAvatar as Loose<typeof RawAdminAvatar>;
const AdminBreadcrumb = RawAdminBreadcrumb as Loose<typeof RawAdminBreadcrumb>;

const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

export interface ShellNavItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
}

export interface ShellNavGroup {
  id: string;
  label: string;
  items: readonly ShellNavItem[];
}

export interface ShellCrumb {
  label: string;
  /** Sem `href` (ou no último item) é a página atual. */
  href?: string | undefined;
}

export interface ShellBrand {
  /** Nome da escola. */
  name: string;
  /** Endereço da página inicial. */
  href: string;
  /** Marca à esquerda do nome; sem ela, um quadrado com as iniciais. */
  mark?: ReactNode;
}

/** Textos da casca; todos vêm das traduções do site. */
export interface ClassroomShellLabels {
  /** Link "Ir para o conteúdo", o primeiro da página. */
  skipToContent: string;
  /** Nome do menu (do <nav> e da gaveta). */
  menu: string;
  /** Botão do menu com a gaveta fechada. */
  openMenu: string;
  /** Botão do menu com a gaveta aberta, e o botão de fechar dentro dela. */
  closeMenu: string;
  /** Botão do menu com a coluna aberta. */
  collapseMenu: string;
  /** Botão do menu com a coluna recolhida. */
  expandMenu: string;
  /** Nome da trilha de navegação. */
  breadcrumb: string;
}

export interface ClassroomShellProps {
  brand: ShellBrand;
  /** Grupos do menu lateral. */
  groups: readonly ShellNavGroup[];
  /** `id` do item do menu que é a página atual. */
  active?: string | undefined;
  labels: ClassroomShellLabels;
  /** Lado direito da barra superior: tema, notificações, entrar. */
  actions?: ReactNode;
  /** Trilha; o último item é a página atual. */
  crumbs?: readonly ShellCrumb[] | undefined;
  /** Rodapé (ex.: um ShellFooter). */
  footer?: ReactNode;
  /** A página. */
  children?: ReactNode;
  /** Componente de link do roteador (vale mais que o do LinkProvider). */
  linkComponent?: LinkComponent | undefined;
  /** Coluna recolhida, controlada de fora (para guardar a escolha no navegador). */
  collapsed?: boolean | undefined;
  /** Estado inicial da coluna quando `collapsed` não é informado. */
  defaultCollapsed?: boolean;
  onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  /** Largura da tela (px) abaixo da qual o menu é uma gaveta. */
  drawerBelow?: number;
  /** `id` da área de conteúdo, alvo do link "Ir para o conteúdo". */
  contentId?: string;
  /** Referência do <main>, para o site levar o foco ao conteúdo na troca de página. */
  mainRef?: Ref<HTMLElement> | undefined;
  /** Texto anunciado aos leitores de tela (ex.: o nome da página, ao trocar de página). */
  announcement?: string | undefined;
  className?: string | undefined;
}

/** Casca do site do aluno. */
export function ClassroomShell({
  brand,
  groups,
  active,
  labels,
  actions,
  crumbs,
  footer,
  children,
  linkComponent,
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  drawerBelow = 1024,
  contentId = 'conteudo',
  mainRef,
  announcement,
  className,
}: ClassroomShellProps) {
  const Link = useLinkComponent(linkComponent);
  const baseId = useId();
  const menuId = `${baseId}menu`;

  const isDrawer = useNarrowViewport(drawerBelow);
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed);
  const [drawerWanted, setDrawerWanted] = useState(false);
  const drawerOpen = isDrawer && drawerWanted;
  const collapsed = !isDrawer && (collapsedProp ?? ownCollapsed);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawerFocus(drawerOpen, closeRef, toggleRef, () => setDrawerWanted(false));
  useEffect(() => {
    if (!isDrawer) setDrawerWanted(false);
  }, [isDrawer]);

  const closeDrawer = () => setDrawerWanted(false);
  const toggleMenu = () => {
    if (isDrawer) {
      setDrawerWanted(!drawerOpen);
      return;
    }
    if (collapsedProp === undefined) setOwnCollapsed(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const menuExpanded = isDrawer ? drawerOpen : !collapsed;
  const toggleLabel = isDrawer
    ? drawerOpen
      ? labels.closeMenu
      : labels.openMenu
    : collapsed
      ? labels.expandMenu
      : labels.collapseMenu;

  return (
    <div className={cx('minui-adm', 'minui-room', className)}>
      <TextLink href={`#${contentId}`} className="minui-room__skip">
        {labels.skipToContent}
      </TextLink>

      <header className="minui-room__top" inert={drawerOpen}>
        <AdminButton
          ref={toggleRef}
          variant="ghost"
          icon={<PanelLeft aria-hidden="true" />}
          aria-label={toggleLabel}
          aria-expanded={menuExpanded}
          aria-controls={menuId}
          title={toggleLabel}
          onClick={toggleMenu}
        />
        <Link href={brand.href} className="minui-room__brand">
          <span className="minui-room__brand-mark" aria-hidden="true">
            {brand.mark ?? <AdminAvatar square size={24} name={brand.name} />}
          </span>
          <span className="minui-room__brand-name">{brand.name}</span>
        </Link>
        {actions ? <div className="minui-room__actions">{actions}</div> : null}
      </header>

      <div className="minui-room__body">
        {drawerOpen ? (
          <div
            className="minui-room__backdrop"
            data-testid="menu-backdrop"
            aria-hidden="true"
            onClick={closeDrawer}
          />
        ) : null}
        <aside
          id={menuId}
          {...(drawerOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': labels.menu } : {})}
          className="minui-room__side"
          data-collapsed={collapsed ? '' : undefined}
          data-drawer={isDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
        >
          {isDrawer ? (
            <div className="minui-room__side-head">
              <span>{labels.menu}</span>
              <AdminButton
                ref={closeRef}
                variant="ghost"
                icon={<X aria-hidden="true" />}
                aria-label={labels.closeMenu}
                title={labels.closeMenu}
                onClick={closeDrawer}
              />
            </div>
          ) : null}
          <nav aria-label={labels.menu} className="minui-room__nav">
            {groups.map((group) => {
              const groupId = `${baseId}g-${group.id}`;
              return (
                <div key={group.id} className="minui-room__group">
                  <p id={groupId} className="minui-room__group-label">
                    {group.label}
                  </p>
                  <ul aria-labelledby={groupId} className="minui-room__list">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className="minui-room__item"
                          aria-current={active === item.id ? 'page' : undefined}
                          title={collapsed ? item.label : undefined}
                          onClick={closeDrawer}
                        >
                          {item.icon}
                          <span className="minui-room__item-text">{item.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="minui-room__page" inert={drawerOpen}>
          {crumbs?.length ? (
            <div className="minui-room__trail">
              <AdminBreadcrumb
                items={crumbs}
                label={labels.breadcrumb}
                linkComponent={linkComponent}
              />
            </div>
          ) : null}
          <main
            id={contentId}
            ref={mainRef}
            tabIndex={-1}
            className="minui-room__content"
            style={{ outline: 'none' }}
          >
            {children}
          </main>
          {footer}
        </div>
      </div>

      <p className="minui-sr-only" aria-live="polite" aria-atomic="true">
        {announcement ?? ''}
      </p>
    </div>
  );
}

export interface ShellFooterLink {
  id: string;
  label: ReactNode;
  href: string;
  /** Abre em outra aba (ex.: o link "Código-fonte"). */
  external?: boolean;
}

export interface ShellFooterProps {
  /** Texto à esquerda: escola, versão. */
  children?: ReactNode;
  links?: readonly ShellFooterLink[];
  /** Texto lido depois de um link externo (ex.: "abre em nova aba"). */
  newTabLabel?: string | undefined;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/**
 * Rodapé das duas cascas (AdminShell e ClassroomShell): um texto e a lista de links,
 * entre eles o "Código-fonte" que a AGPL-3.0 pede (spec 006, RF-11).
 */
export function ShellFooter({
  children,
  links = [],
  newTabLabel,
  linkComponent,
  className,
}: ShellFooterProps) {
  return (
    <footer className={cx('minui-shell-foot', className)}>
      <span className="minui-shell-foot__text">{children}</span>
      {links.length > 0 ? (
        <ul className="minui-shell-foot__links">
          {links.map((link) => (
            <li key={link.id}>
              <TextLink
                href={link.href}
                external={link.external ?? false}
                newTabLabel={newTabLabel}
                linkComponent={linkComponent}
              >
                {link.label}
              </TextLink>
            </li>
          ))}
        </ul>
      ) : null}
    </footer>
  );
}
