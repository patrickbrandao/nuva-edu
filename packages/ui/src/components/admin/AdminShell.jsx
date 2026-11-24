import { ChevronRight, ChevronsUpDown, PanelLeft, X } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import '../../styles/tokens.css';
import './admin.css';
import { cx } from '../../lib/util';
import { isInternalHref, useLinkComponent } from '../link/link';
import { useDrawerFocus, useNarrowViewport } from '../shell/drawer';
import { AdminButton } from './AdminControls';
import { AdminAvatar, AdminBadge } from './AdminData';

/*
 * A casca do painel administrativo: a janela (AdminShell), o menu lateral
 * (AdminSidebar), a barra do topo (AdminTopbar), a trilha (AdminBreadcrumb)
 * e a área de conteúdo (AdminContent).
 *
 * O menu recolhe para uma coluna de ícones pelo botão da marca, e sozinho
 * quando a janela fica estreita (a largura é a do contêiner, não a da tela).
 * Com `drawerBelow`, abaixo dessa largura de tela o menu vira uma gaveta sobre
 * o conteúdo, aberta pelo botão que a AdminTopbar passa a mostrar.
 */

const ShellContext = createContext({ collapsed: false, toggle: undefined, drawer: null });

/** Textos padrão da gaveta (pt-BR); os sites passam os das suas traduções. */
const DRAWER_LABELS = { open: 'Abrir o menu', close: 'Fechar o menu', title: 'Menu' };

/** Escopo dos tokens --adm-*: use em volta de peças soltas, fora da janela. */
export function AdminScope({ tone = 'cool', as: Tag = 'div', className, ...rest }) {
  return (
    <Tag className={cx('minui-adm', tone === 'warm' && 'minui-adm--warm', className)} {...rest} />
  );
}

/**
 * A janela do painel: menu à esquerda, conteúdo à direita.
 * `collapsed` controla o menu de fora; sem ele a janela cuida do estado
 * (recolhe sozinha abaixo de `collapseBelow` px de largura).
 *   fullPage     — ocupa a página inteira: sem borda, raio nem sombra, e com a
 *                  altura da tela (100dvh) quando `height` não é informado.
 *   drawerBelow  — largura da tela (px) abaixo da qual o menu é uma gaveta
 *                  (spec 006, RNF-01: 1024). Sem ele não há gaveta.
 *   drawerLabels — { open, close, title }: nomes do botão e da gaveta.
 */
export function AdminShell({
  tone = 'cool',
  height,
  fullPage = false,
  sidebar,
  collapsed: collapsedProp,
  defaultCollapsed,
  onCollapsedChange,
  collapseBelow = 720,
  drawerBelow,
  drawerLabels = DRAWER_LABELS,
  className,
  style,
  children,
}) {
  const ref = useRef(null);
  const [own, setOwn] = useState(defaultCollapsed ?? null);
  // A janela nunca é mais larga que a tela: em tela estreita o menu já nasce recolhido.
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < collapseBelow,
  );
  // Até a primeira pintura o menu não anima a largura (senão ele "pisca" ao recolher sozinho).
  const [booting, setBooting] = useState(true);
  useEffect(() => setBooting(false), []);

  const drawerId = useId();
  const toggleRef = useRef(null);
  const closeRef = useRef(null);
  const isDrawer = useNarrowViewport(drawerBelow);
  const [drawerWanted, setDrawerWanted] = useState(false);
  const drawerOpen = isDrawer && drawerWanted;
  useDrawerFocus(drawerOpen, closeRef, toggleRef, () => setDrawerWanted(false));
  useEffect(() => {
    if (!isDrawer) setDrawerWanted(false);
  }, [isDrawer]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setNarrow(node.clientWidth < collapseBelow);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapseBelow]);

  // Na gaveta o menu aparece sempre inteiro; recolher é coisa da coluna fixa.
  const collapsed = isDrawer ? false : (collapsedProp ?? own ?? narrow);
  const toggle = () => {
    if (collapsedProp == null) setOwn(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const drawer = isDrawer
    ? {
        id: drawerId,
        open: drawerOpen,
        toggle: () => setDrawerWanted(!drawerOpen),
        close: () => setDrawerWanted(false),
        labels: { ...DRAWER_LABELS, ...drawerLabels },
        toggleRef,
        closeRef,
      }
    : null;
  const shellHeight = height ?? (fullPage ? '100dvh' : 780);

  return (
    <ShellContext.Provider value={{ collapsed, toggle, drawer }}>
      <div
        ref={ref}
        className={cx(
          'minui-adm',
          'minui-adm-shell',
          tone === 'warm' && 'minui-adm--warm',
          fullPage && 'minui-adm-shell--page',
          className,
        )}
        data-drawer={isDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
        data-booting={booting ? '' : undefined}
        style={{
          '--adm-height': typeof shellHeight === 'number' ? `${shellHeight}px` : shellHeight,
          ...style,
        }}
      >
        {drawerOpen ? (
          <div
            className="minui-adm-backdrop"
            data-testid="menu-backdrop"
            aria-hidden="true"
            onClick={() => setDrawerWanted(false)}
          />
        ) : null}
        {sidebar}
        <div className="minui-adm-main" inert={drawerOpen || undefined}>
          {children}
        </div>
      </div>
    </ShellContext.Provider>
  );
}

/**
 * Um item do menu. Com `href` é um link; sem, um <button>.
 * Link de endereço interno usa o componente de link do site (`linkComponent`).
 */
function NavItem({ item, active, onNavigate, linkComponent }) {
  const Link = useLinkComponent(linkComponent, { href: item.href, target: item.target });
  const Tag = item.href ? Link : 'button';
  const props = item.href ? { href: item.href } : { type: 'button' };
  const current = active === item.id;
  return (
    <li>
      <Tag
        {...props}
        className="minui-adm-nav__item"
        aria-current={current ? 'page' : undefined}
        title={item.label}
        onClick={onNavigate ? (event) => onNavigate(item.id, item, event) : undefined}
      >
        {item.avatar ? <AdminAvatar size={20} name={item.label} {...item.avatar} /> : item.icon}
        <span className="minui-adm-nav__text">{item.label}</span>
        {item.badge != null ? <AdminBadge>{item.badge}</AdminBadge> : null}
      </Tag>
      {item.children?.length ? (
        <ul className="minui-adm-nav__sub">
          {item.children.map((child) => (
            <NavItem
              key={child.id}
              item={child}
              active={active}
              onNavigate={onNavigate}
              linkComponent={linkComponent}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * As seções do menu, sem a moldura — é o miolo do AdminSidebar.
 * sections: [{ id, label?, bottom?, items: [{ id, label, icon | avatar, badge?, href?, children? }] }]
 * `onNavigate(id, item, evento)` é chamado no clique; `linkComponent` é o link do roteador.
 */
export function AdminNav({ sections = [], active, onNavigate, linkComponent }) {
  return sections.map((section) => (
    <div
      key={section.id}
      className={cx('minui-adm-nav-group', section.bottom && 'minui-adm-nav--bottom')}
    >
      {section.label ? <p className="minui-adm-nav__label">{section.label}</p> : null}
      <ul className="minui-adm-nav">
        {section.items.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            active={active}
            onNavigate={onNavigate}
            linkComponent={linkComponent}
          />
        ))}
      </ul>
    </div>
  ));
}

/**
 * Menu lateral.
 *   brand    — { name, mark, sup?, color? }
 *   sections — [{ id, label?, bottom?, items: [{ id, label, icon | avatar, badge?, href?, children? }] }]
 *              `bottom: true` empurra a seção para o pé do menu.
 *   user     — { name, role?, src?, color? } e `userAction` (ícone à direita).
 *   flat     — sem os filetes da marca e do usuário (o estilo do tom "warm").
 *   navLabel — nome acessível do <nav> (padrão: "Menu de <marca>").
 *   linkComponent — componente de link do roteador para os itens com `href`.
 * Dentro de um AdminShell em modo gaveta, o menu abre sobre o conteúdo como um
 * diálogo, com botão de fechar; Esc e o clique em um item também fecham.
 */
export function AdminSidebar({
  brand,
  sections = [],
  active,
  onNavigate,
  user,
  userAction = <ChevronsUpDown size={15} />,
  flat = false,
  collapsed: collapsedProp,
  onToggle,
  toggleLabel = ['Recolher o menu', 'Expandir o menu'],
  navLabel,
  linkComponent,
  className,
}) {
  const shell = useContext(ShellContext);
  const drawer = shell.drawer;
  const collapsed = drawer ? false : (collapsedProp ?? shell.collapsed);
  const toggle = onToggle ?? shell.toggle;
  const navigate = drawer
    ? (id, item, event) => {
        drawer.close();
        onNavigate?.(id, item, event);
      }
    : onNavigate;
  const dialog = drawer?.open
    ? { role: 'dialog', 'aria-modal': true, 'aria-label': drawer.labels.title }
    : {};

  return (
    <aside
      {...dialog}
      id={drawer?.id}
      className={cx('minui-adm-side', flat && 'minui-adm-side--flat', className)}
      data-collapsed={collapsed ? '' : undefined}
      data-drawer={drawer ? (drawer.open ? 'open' : 'closed') : undefined}
    >
      <div className="minui-adm-side__brand">
        {brand ? (
          <span
            className="minui-adm-brand"
            style={brand.color ? { '--adm-brand': brand.color } : undefined}
          >
            {brand.mark ? <span className="minui-adm-brand__mark">{brand.mark}</span> : null}
            <span>
              {brand.name}
              {brand.sup ? <sup>{brand.sup}</sup> : null}
            </span>
          </span>
        ) : null}
        {drawer ? (
          <AdminButton
            ref={drawer.closeRef}
            variant="ghost"
            icon={<X aria-hidden="true" />}
            aria-label={drawer.labels.close}
            title={drawer.labels.close}
            onClick={drawer.close}
          />
        ) : toggle ? (
          <AdminButton
            variant="ghost"
            icon={<PanelLeft />}
            aria-label={toggleLabel[collapsed ? 1 : 0]}
            aria-expanded={!collapsed}
            title={toggleLabel[collapsed ? 1 : 0]}
            onClick={toggle}
          />
        ) : null}
      </div>

      <nav
        className="minui-adm-side__scroll"
        aria-label={navLabel ?? (brand?.name ? `Menu de ${brand.name}` : 'Menu')}
      >
        <AdminNav
          sections={sections}
          active={active}
          onNavigate={navigate}
          linkComponent={linkComponent}
        />
      </nav>

      {user ? (
        <div className="minui-adm-user">
          <AdminAvatar
            size={user.role ? 30 : 22}
            name={user.name}
            src={user.src}
            color={user.color}
          />
          <span className="minui-adm-user__text">
            <strong>{user.name}</strong>
            {user.role ? <span>{user.role}</span> : null}
          </span>
          {userAction ? <span className="minui-adm-user__action">{userAction}</span> : null}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * Barra do topo: `title` (ou `children`, ex.: uma trilha) à esquerda, `actions` à direita.
 * Com o AdminShell em modo gaveta, mostra antes de tudo o botão que abre o menu.
 */
export function AdminTopbar({ title, actions, children, className }) {
  const { drawer } = useContext(ShellContext);
  const menuLabel = drawer ? drawer.labels[drawer.open ? 'close' : 'open'] : undefined;
  return (
    <header className={cx('minui-adm-top', className)}>
      {drawer ? (
        <AdminButton
          ref={drawer.toggleRef}
          variant="ghost"
          icon={<PanelLeft aria-hidden="true" />}
          aria-label={menuLabel}
          aria-expanded={drawer.open}
          aria-controls={drawer.id}
          title={menuLabel}
          onClick={drawer.toggle}
        />
      ) : null}
      {title ? <h1 className="minui-adm-top__title">{title}</h1> : null}
      {children}
      {actions ? <div className="minui-adm-top__actions">{actions}</div> : null}
    </header>
  );
}

/**
 * Trilha: [{ label, icon?, href?, onClick? }]. O último item é a página atual.
 * Item com `href` interno usa o componente de link do site (`linkComponent`).
 */
export function AdminBreadcrumb({ items = [], label = 'Trilha', linkComponent }) {
  const Link = useLinkComponent(linkComponent);
  return (
    <nav aria-label={label}>
      <ol className="minui-adm-crumbs">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const body = (
            <>
              {item.icon}
              {item.label}
            </>
          );
          return (
            <li key={item.label}>
              {last ? (
                <span className="minui-adm-crumbs__here" aria-current="page">
                  {body}
                </span>
              ) : item.href ? (
                isInternalHref(item.href) ? (
                  <Link href={item.href} onClick={item.onClick}>
                    {body}
                  </Link>
                ) : (
                  <a href={item.href} onClick={item.onClick}>
                    {body}
                  </a>
                )
              ) : (
                <button type="button" onClick={item.onClick}>
                  {body}
                </button>
              )}
              {last ? null : (
                <ChevronRight size={14} className="minui-adm-crumbs__sep" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Área de conteúdo com rolagem. `flush` tira o respiro (para o quadro). */
export function AdminContent({ flush = false, className, children }) {
  return (
    <div className={cx('minui-adm-content', flush && 'minui-adm-content--flush', className)}>
      {children}
    </div>
  );
}
