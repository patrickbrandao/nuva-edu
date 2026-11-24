import './admin.css';
import { cx, hueOf } from '../../lib/util';
import { Avatar } from '../core/Avatar';

/*
 * Peças de dado do AdminUI: etiqueta, selo, estado, avatar, cartão, bloco
 * numérico, seção, cabeçalho de página, metadados, detalhes, lista em cartão,
 * mensagens, linha do tempo, tabela e estado vazio.
 *
 * `tone` aceita: green, amber, red, orange, blue, indigo, cyan, pink, rose,
 * violet e gray.
 */

/** Etiqueta neutra de categoria ("Domestic Violence"). */
export function AdminTag({ className, children }) {
  return <span className={cx('minui-adm-tag', className)}>{children}</span>;
}

/** Selo de contagem — vermelho por padrão, cinza com `muted`. */
export function AdminBadge({ muted = false, className, children }) {
  return (
    <span className={cx('minui-adm-badge', muted && 'minui-adm-badge--muted', className)}>
      {children}
    </span>
  );
}

/** Bolinha de cor (cabeçalho das colunas do quadro). */
export function AdminDot({ tone = 'gray', className }) {
  return <span className={cx('minui-adm-dot', className)} data-tone={tone} aria-hidden="true" />;
}

/**
 * Estado: tracinho vertical + rótulo, os dois na cor de `tone` ("Active").
 * `dot` troca o tracinho por uma bolinha e deixa o texto na cor normal.
 */
export function AdminStatus({ tone = 'gray', dot = false, className, children }) {
  return (
    <span
      className={cx('minui-adm-status', dot && 'minui-adm-status--dot', className)}
      data-tone={tone}
    >
      {children}
    </span>
  );
}

/**
 * Avatar redondo. `src` é uma imagem; sem ela, a inicial do nome
 * sobre uma cor (`color`, ou uma derivada do nome). `square` é o selo
 * quadrado-arredondado (logotipo de veículo); `soft`, o fundo cinza.
 */
export function AdminAvatar({
  name = '',
  src,
  color,
  size = 22,
  square = false,
  soft = false,
  initials,
  className,
}) {
  const photo = src;
  const hue = hueOf(name);
  return (
    <span
      className={cx(
        'minui-adm-avatar',
        square && 'minui-adm-avatar--square',
        soft && 'minui-adm-avatar--soft',
        className,
      )}
      role="img"
      aria-label={name || undefined}
      style={{
        '--adm-av': `${size}px`,
        '--adm-av-bg': photo || soft ? undefined : (color ?? `hsl(${hue} 62% 46%)`),
      }}
    >
      {photo ? (
        <Avatar name={name} src={src} size={size} radius={0} />
      ) : (
        (initials ?? name.trim().charAt(0).toUpperCase())
      )}
    </span>
  );
}

/** Fileira de avatares sobrepostos. */
export function AdminAvatars({ people = [], size = 22 }) {
  return (
    <span className="minui-adm-avatars">
      {people.map((person) => (
        <AdminAvatar key={person.name} size={size} {...person} />
      ))}
    </span>
  );
}

/** Cartão: fundo branco, contorno fino, sombra de 1px. `pad` põe o respiro padrão. */
export function AdminCard({
  as: Tag = 'div',
  pad = false,
  interactive = false,
  className,
  ...rest
}) {
  return (
    <Tag
      className={cx(
        'minui-adm-card',
        pad && 'minui-adm-card--pad',
        interactive && 'minui-adm-card--link',
        className,
      )}
      {...rest}
    />
  );
}

/** Grade de blocos numéricos: [{ id?, value, label, tone? }]. */
export function AdminStats({ stats = [], columns, className }) {
  return (
    <div
      className={cx('minui-adm-stats', className)}
      style={{ '--adm-cols': columns ?? stats.length }}
    >
      {stats.map((stat) => (
        <AdminStat key={stat.id ?? stat.label} {...stat} />
      ))}
    </div>
  );
}

/** Um bloco numérico: o valor grande e o rótulo. `tone` colore o valor. */
export function AdminStat({ value, label, tone }) {
  return (
    <AdminCard className="minui-adm-stat" data-tone={tone}>
      <span className="minui-adm-stat__value">{value}</span>
      <span className="minui-adm-stat__label">{label}</span>
    </AdminCard>
  );
}

/** Seção com título (h2) e ações à direita. */
export function AdminSection({ title, actions, className, children }) {
  return (
    <section className={cx('minui-adm-section', className)}>
      <div className="minui-adm-section__head">
        <h2 className="minui-adm-section__title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Cabeçalho de página: título, subtítulo e os botões à direita, sobre um filete. */
export function AdminPageHeader({ title, subtitle, actions }) {
  return (
    <header className="minui-adm-pagehead">
      <div className="minui-adm-pagehead__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="minui-adm-pagehead__actions">{actions}</div> : null}
    </header>
  );
}

/** Linhas de metadado: [{ id?, icon, text, tone? }]. */
export function AdminMeta({ items = [], className }) {
  return (
    <ul className={cx('minui-adm-meta', className)}>
      {items.map((item) => (
        <li key={item.id ?? item.text} data-tone={item.tone}>
          {item.icon}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Lista de detalhes: [{ label, icon, value }].
 * `wrap` deixa o valor quebrar linha em vez de cortar com reticências.
 */
export function AdminDetails({ items = [], wrap = false, className }) {
  return (
    <dl className={cx('minui-adm-details', wrap && 'minui-adm-details--wrap', className)}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>
            {item.icon}
            {item.label}
          </dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Lista em cartão, uma linha por item: [{ id?, icon, title, text, aside: [..] }].
 * `aside` são os pedaços da direita, separados por "·".
 */
export function AdminList({ items = [], className }) {
  return (
    <AdminCard as="ul" className={cx('minui-adm-list', className)}>
      {items.map((item) => (
        <li key={item.id ?? item.title}>
          <div className="minui-adm-list__row">
            {item.icon}
            <span className="minui-adm-list__main">
              <strong>{item.title}</strong>
              {item.text ? <span>{item.text}</span> : null}
            </span>
            {item.aside?.length ? (
              <span className="minui-adm-list__aside">
                {item.aside.map((part, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional, sem identidade própria
                    key={index}
                    className={index ? 'minui-adm-sep' : undefined}
                    style={index ? { display: 'inline-flex', gap: 7 } : undefined}
                  >
                    {part}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </AdminCard>
  );
}

/** Mensagens recentes: [{ id?, name, src?, color?, time, text }]. */
export function AdminMessages({ messages = [], onOpen, className }) {
  return (
    <AdminCard as="ul" className={cx('minui-adm-list', className)}>
      {messages.map((message) => (
        <li key={message.id ?? message.name}>
          <button
            type="button"
            className="minui-adm-msg"
            onClick={onOpen ? () => onOpen(message) : undefined}
          >
            <span className="minui-adm-msg__head">
              <AdminAvatar size={18} name={message.name} src={message.src} color={message.color} />
              <strong>{message.name}</strong>
              <time>{message.time}</time>
            </span>
            <span className="minui-adm-msg__text">{message.text}</span>
          </button>
        </li>
      ))}
    </AdminCard>
  );
}

/**
 * Linha do tempo: [{ id?, icon, text, time }]. Em `text`, o que estiver em
 * <strong> fica na cor forte e o resto na cor suave.
 */
export function AdminTimeline({ items = [], className }) {
  return (
    <ol className={cx('minui-adm-timeline', className)}>
      {items.map((item) => (
        <li key={item.id ?? item.time}>
          <span className="minui-adm-timeline__icon">{item.icon}</span>
          <div>
            <p>{item.text}</p>
            <time>{item.time}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Tabela em cartão. columns: [{ id, label, render?(row) }]; a primeira coluna
 * é a principal (texto forte). rows precisam de `id`.
 */
export function AdminTable({ columns = [], rows = [], empty, className }) {
  return (
    <AdminCard className={cx('minui-adm-tablewrap', className)}>
      <table className="minui-adm-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column, index) => {
                const cell = column.render ? column.render(row) : row[column.id];
                return (
                  <td key={column.id}>
                    {index === 0 ? <span className="minui-adm-table__main">{cell}</span> : cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? empty : null}
    </AdminCard>
  );
}

/** Estado vazio: ícone, título e uma frase. */
export function AdminEmpty({ icon, title, text, children }) {
  return (
    <div className="minui-adm-empty">
      {icon}
      {title ? <strong>{title}</strong> : null}
      {text ? <span>{text}</span> : null}
      {children}
    </div>
  );
}
