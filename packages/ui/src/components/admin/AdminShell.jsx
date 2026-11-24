import { ChevronRight, ChevronsUpDown, PanelLeft } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import '../../styles/tokens.css';
import './admin.css';
import { cx } from '../../lib/util';
import { AdminButton } from './AdminControls';
import { AdminAvatar, AdminBadge } from './AdminData';

/*
 * A casca do painel administrativo: a janela (AdminShell), o menu lateral
 * (AdminSidebar), a barra do topo (AdminTopbar), a trilha (AdminBreadcrumb)
 * e a área de conteúdo (AdminContent).
 *
 * O menu recolhe para uma coluna de ícones pelo botão da marca, e sozinho
 * quando a janela fica estreita (a largura é a do contêiner, não a da tela).
 */

const ShellContext = createContext({ collapsed: false, toggle: undefined });

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
 */
export function AdminShell({
  tone = 'cool',
  height = 780,
  sidebar,
  collapsed: collapsedProp,
  defaultCollapsed,
  onCollapsedChange,
  collapseBelow = 720,
  className,
  style,
  children,
}) {
  const ref = useRef(null);
  const [own, setOwn] = useState(defaultCollapsed ?? null);
  const [narrow, setNarrow] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setNarrow(node.clientWidth < collapseBelow);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapseBelow]);

  const collapsed = collapsedProp ?? own ?? narrow;
  const toggle = () => {
    if (collapsedProp == null) setOwn(!collapsed);
    onCollapsedChange?.(!collapsed);
  };

  return (
    <ShellContext.Provider value={{ collapsed, toggle }}>
      <div
        ref={ref}
        className={cx(
          'minui-adm',
          'minui-adm-shell',
          tone === 'warm' && 'minui-adm--warm',
          className,
        )}
        style={{ '--adm-height': typeof height === 'number' ? `${height}px` : height, ...style }}
      >
        {sidebar}
        <div className="minui-adm-main">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}

/** Um item do menu. Com `href` é um link; sem, um <button>. */
function NavItem({ item, active, onNavigate }) {
  const Tag = item.href ? 'a' : 'button';
  const props = item.href ? { href: item.href } : { type: 'button' };
  const current = active === item.id;
  return (
    <li>
      <Tag
        {...props}
        className="minui-adm-nav__item"
        aria-current={current ? 'page' : undefined}
        title={item.label}
        onClick={onNavigate ? () => onNavigate(item.id, item) : undefined}
      >
        {item.avatar ? <AdminAvatar size={20} name={item.label} {...item.avatar} /> : item.icon}
        <span className="minui-adm-nav__text">{item.label}</span>
        {item.badge != null ? <AdminBadge>{item.badge}</AdminBadge> : null}
      </Tag>
      {item.children?.length ? (
        <ul className="minui-adm-nav__sub">
          {item.children.map((child) => (
            <NavItem key={child.id} item={child} active={active} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * As seções do menu, sem a moldura — é o miolo do AdminSidebar.
 * sections: [{ id, label?, bottom?, items: [{ id, label, icon | avatar, badge?, href?, children? }] }]
 */
export function AdminNav({ sections = [], active, onNavigate }) {
  return sections.map((section) => (
    <div
      key={section.id}
      className={cx('minui-adm-nav-group', section.bottom && 'minui-adm-nav--bottom')}
    >
      {section.label ? <p className="minui-adm-nav__label">{section.label}</p> : null}
      <ul className="minui-adm-nav">
        {section.items.map((item) => (
          <NavItem key={item.id} item={item} active={active} onNavigate={onNavigate} />
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
  className,
}) {
  const shell = useContext(ShellContext);
  const collapsed = collapsedProp ?? shell.collapsed;
  const toggle = onToggle ?? shell.toggle;

  return (
    <aside
      className={cx('minui-adm-side', flat && 'minui-adm-side--flat', className)}
      data-collapsed={collapsed ? '' : undefined}
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
        {toggle ? (
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
        aria-label={brand?.name ? `Menu de ${brand.name}` : 'Menu'}
      >
        <AdminNav sections={sections} active={active} onNavigate={onNavigate} />
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

/** Barra do topo: `title` (ou `children`, ex.: uma trilha) à esquerda, `actions` à direita. */
export function AdminTopbar({ title, actions, children, className }) {
  return (
    <header className={cx('minui-adm-top', className)}>
      {title ? <h1 className="minui-adm-top__title">{title}</h1> : null}
      {children}
      {actions ? <div className="minui-adm-top__actions">{actions}</div> : null}
    </header>
  );
}

/** Trilha: [{ label, icon?, href?, onClick? }]. O último item é a página atual. */
export function AdminBreadcrumb({ items = [], label = 'Trilha' }) {
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
                <a href={item.href}>{body}</a>
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
