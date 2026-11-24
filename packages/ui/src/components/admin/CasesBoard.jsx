import {
  Banknote,
  Bell,
  BookOpen,
  Calendar,
  ChevronsRight,
  CircleQuestionMark,
  Clock,
  FileText,
  FolderCog,
  GitBranch,
  GraduationCap,
  Hash,
  House,
  List,
  ListTree,
  MessageCircle,
  SearchX,
  Sparkles,
  SquareKanban,
  Timer,
  User,
  WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminMenu, AdminSearch } from './AdminControls';
import {
  AdminAvatar,
  AdminCard,
  AdminDot,
  AdminEmpty,
  AdminMeta,
  AdminStatus,
  AdminTable,
  AdminTag,
} from './AdminData';
import { AdminContent, AdminShell, AdminSidebar, AdminTopbar } from './AdminShell';

/*
 * Quadro de casos ("Cases"): o painel administrativo em tom frio com o menu
 * lateral completo, a barra do topo (busca, visão e filtros) e um quadro
 * kanban — uma coluna por etapa, um cartão por caso. Os cartões podem ser
 * arrastados entre as colunas; a visão "List" mostra os mesmos casos numa
 * tabela. Tudo HTML, CSS e SVG, nos dois temas.
 */

const I = { strokeWidth: 1.75, 'aria-hidden': true };

export const CASES_BRAND = {
  name: 'Closure',
  sup: 'ai',
  mark: <ChevronsRight size={24} strokeWidth={3.2} />,
  color: 'var(--adm-blue)',
};

/** O menu lateral: principal, casos recentes e o pé (ajuda). */
export const CASES_NAV = [
  {
    id: 'main',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <House {...I} /> },
      { id: 'notifications', label: 'Notifications', icon: <Bell {...I} />, badge: 3 },
      { id: 'cases', label: 'Cases', icon: <WalletCards {...I} /> },
      { id: 'messages', label: 'Messages', icon: <MessageCircle {...I} /> },
      { id: 'calendar', label: 'Calendar', icon: <Calendar {...I} /> },
      { id: 'resources', label: 'Resources', icon: <BookOpen {...I} /> },
      { id: 'reports', label: 'Reports', icon: <FileText {...I} /> },
      { id: 'automations', label: 'Automations', icon: <GitBranch {...I} /> },
      { id: 'training', label: 'Training', icon: <GraduationCap {...I} /> },
      { id: 'funds', label: 'Funds', icon: <Banknote {...I} /> },
      { id: 'time-tracking', label: 'Time Tracking', icon: <Timer {...I} /> },
    ],
  },
  {
    id: 'recent',
    label: 'Recent Cases',
    items: [
      { id: 'recent-marvin', label: 'Marvin Bell', avatar: { color: '#7c3aed' } },
      { id: 'recent-andrea', label: 'Andrea Torres', avatar: { color: '#0e8fb8' } },
      { id: 'recent-esther', label: 'Esther Howard', avatar: { color: '#ea580c' } },
    ],
  },
  {
    id: 'help',
    bottom: true,
    items: [
      { id: 'support', label: 'Support', icon: <CircleQuestionMark {...I} /> },
      { id: 'whats-new', label: 'What’s New', icon: <Sparkles {...I} /> },
      { id: 'roadmap', label: 'Roadmap', icon: <ListTree {...I} /> },
    ],
  },
];

export const CASES_USER = { name: 'Rachel Windman', role: 'Advocate' };

/** As etapas do quadro, na ordem das colunas. */
export const CASES_COLUMNS = [
  { id: 'pending', label: 'Pending', tone: 'indigo' },
  { id: 'intake', label: 'Intake', tone: 'cyan' },
  { id: 'assigned', label: 'Assigned', tone: 'pink' },
  { id: 'follow-up', label: 'Follow Up', tone: 'rose' },
];

/** Os casos. `hours` é há quantas horas foi a última atualização. */
export const CASES = [
  {
    id: '23-0001',
    status: 'pending',
    name: 'Maria Garcia',
    type: 'Domestic Violence',
    file: '32003',
    advocate: 'Leslie Alexander',
    hours: 2,
  },
  {
    id: '23-0002',
    status: 'pending',
    name: 'Andrea Torres',
    type: 'Assault',
    file: '25323',
    advocate: 'Guy Hawkins',
    hours: 2,
  },
  {
    id: '23-0003',
    status: 'intake',
    name: 'Emily Wilson',
    color: '#3d3fd6',
    type: 'Human Trafficking',
    file: '25323',
    advocate: 'Jacob Jones',
    hours: 3,
  },
  {
    id: '23-0004',
    status: 'intake',
    name: 'Thomas Brown',
    type: 'Domestic Violence',
    file: '25323',
    advocate: 'Cody Fisher',
    hours: 5,
  },
  {
    id: '23-0005',
    status: 'intake',
    name: 'Sofia Martinez',
    color: '#7c3aed',
    type: 'Sexual Assault',
    file: '25323',
    advocate: 'Leslie Alexander',
    hours: 7,
  },
  {
    id: '23-0006',
    status: 'assigned',
    name: 'Isabella Lopez',
    type: 'Sexual Assault',
    file: '25323',
    advocate: 'Kathryn Murphy',
    hours: 6,
  },
  {
    id: '23-0007',
    status: 'assigned',
    name: 'William Taylor',
    color: '#0f7f86',
    type: 'Elder Abuse',
    file: '25323',
    advocate: 'Jacob Jones',
    hours: 7,
  },
  {
    id: '23-0008',
    status: 'assigned',
    name: 'Olivia Davis',
    color: '#16a34a',
    type: 'Domestic Violence',
    file: '25323',
    advocate: 'Savannah Nguyen',
    hours: 7,
  },
  {
    id: '23-0009',
    status: 'follow-up',
    name: 'Maria Garcia',
    type: 'Domestic Violence',
    file: '32003',
    advocate: 'Leslie Alexander',
    hours: 24,
    overdue: true,
  },
  {
    id: '23-0010',
    status: 'follow-up',
    name: 'Andrea Torres',
    type: 'Assault',
    file: '25323',
    advocate: 'Guy Hawkins',
    hours: 192,
    overdue: true,
  },
];

const VIEWS = [
  { id: 'board', label: 'Board', icon: <SquareKanban {...I} /> },
  { id: 'list', label: 'List', icon: <List {...I} /> },
];

const RANGES = [
  { id: 'any', label: 'Any time' },
  { id: '3', label: 'Last 3 hours' },
  { id: '6', label: 'Last 6 hours' },
  { id: '24', label: 'Last 24 hours' },
];

/** "2 hours ago", "1 day ago", "8 days ago". */
export function timeAgo(hours) {
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** O cartão de um caso: avatar e nome, o tipo e as quatro linhas de metadado. */
export function CaseCard({ item, as = 'div', onOpen, className, ...rest }) {
  return (
    <AdminCard
      as={as}
      className={['minui-adm-case', className].filter(Boolean).join(' ')}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(item) : undefined}
      onKeyDown={onOpen ? (event) => event.key === 'Enter' && onOpen(item) : undefined}
      {...rest}
    >
      <h3 className="minui-adm-case__name">
        <AdminAvatar size={22} name={item.name} src={item.src} color={item.color} />
        <span>{item.name}</span>
      </h3>
      <AdminTag>{item.type}</AdminTag>
      <hr className="minui-adm-rule" />
      <AdminMeta
        items={[
          { id: 'id', icon: <Hash {...I} />, text: item.id },
          { id: 'file', icon: <FolderCog {...I} />, text: item.file },
          { id: 'advocate', icon: <User {...I} />, text: item.advocate },
          {
            id: 'time',
            icon: <Clock {...I} />,
            text: timeAgo(item.hours),
            tone: item.overdue ? 'orange' : undefined,
          },
        ]}
      />
    </AdminCard>
  );
}

/** Uma coluna do quadro: a bolinha, o nome da etapa e os cartões. */
export function CaseColumn({
  column,
  items,
  count = false,
  dragging,
  onDragCard,
  onDropCard,
  onOpen,
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      className="minui-adm-col"
      data-tone={column.tone}
      data-over={over ? '' : undefined}
      aria-label={column.label}
      onDragOver={(event) => {
        if (!onDropCard) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget) && setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDropCard?.(event.dataTransfer.getData('text/plain'), column.id);
      }}
    >
      <header className="minui-adm-col__head">
        <AdminDot tone={column.tone} />
        {column.label}
        {count ? <span className="minui-adm-col__count">{items.length}</span> : null}
      </header>
      <ul className="minui-adm-col__list">
        {items.map((item) => (
          <CaseCard
            key={item.id}
            as="li"
            item={item}
            onOpen={onOpen}
            draggable={!!onDropCard}
            data-dragging={dragging === item.id ? '' : undefined}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', item.id);
              event.dataTransfer.effectAllowed = 'move';
              onDragCard?.(item.id);
            }}
            onDragEnd={() => onDragCard?.(null)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * A página inteira. O quadro guarda a posição dos cartões; `onMove(id, etapa,
 * caso)` avisa cada vez que um cartão muda de coluna e `onOpen(caso)` quando
 * um cartão é clicado. `onNavigate(id, item)` avisa os cliques no menu.
 */
export function CasesBoard({
  brand = CASES_BRAND,
  nav = CASES_NAV,
  user = CASES_USER,
  columns = CASES_COLUMNS,
  cases = CASES,
  title = 'Cases',
  defaultActive = 'cases',
  defaultView = 'board',
  showCount = false,
  onNavigate,
  onMove,
  onOpen,
  height = 780,
  className,
  style,
}) {
  const [items, setItems] = useState(cases);
  const [active, setActive] = useState(defaultActive);
  const [view, setView] = useState(defaultView);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('any');
  const [assignee, setAssignee] = useState('any');
  const [dragging, setDragging] = useState(null);
  const board = useRef(null);
  const [more, setMore] = useState(false);

  useEffect(() => setItems(cases), [cases]);

  const assignees = useMemo(
    () => [
      { id: 'any', label: 'Anyone' },
      'separator',
      ...[...new Set(cases.map((c) => c.advocate))]
        .sort()
        .map((name) => ({ id: name, label: name })),
    ],
    [cases],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!term ||
          `${item.name} ${item.type} ${item.id} ${item.file} ${item.advocate}`
            .toLowerCase()
            .includes(term)) &&
        (range === 'any' || item.hours <= Number(range)) &&
        (assignee === 'any' || item.advocate === assignee),
    );
  }, [items, query, range, assignee]);

  // há colunas escondidas à direita? então a borda do quadro some num degradê
  // biome-ignore lint/correctness/useExhaustiveDependencies: trocar de visão ou de número de colunas pede nova medição
  useEffect(() => {
    const node = board.current;
    if (!node) return undefined;
    const update = () => setMore(node.scrollWidth - node.clientWidth - node.scrollLeft > 4);
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [view, columns.length]);

  const move = (id, status) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.status === status) return;
    // o cartão movido vai para o fim da coluna de destino
    setItems((list) => [...list.filter((entry) => entry.id !== id), { ...item, status }]);
    onMove?.(id, status, item);
  };

  const navigate = (id, item) => {
    setActive(id);
    onNavigate?.(id, item);
  };

  const statusOf = (item) => columns.find((column) => column.id === item.status);

  return (
    <AdminShell
      tone="cool"
      height={height}
      className={className}
      style={style}
      sidebar={
        <AdminSidebar
          brand={brand}
          sections={nav}
          user={user}
          active={active}
          onNavigate={navigate}
        />
      }
    >
      <AdminTopbar
        title={title}
        actions={
          <>
            <AdminSearch value={query} onChange={setQuery} label="Search cases" />
            <AdminMenu options={VIEWS} value={view} onChange={setView} aria-label="View" />
            <AdminMenu
              options={RANGES}
              value={range}
              onChange={setRange}
              label="Date Range"
              showValue={range !== 'any'}
              icon={<Calendar {...I} />}
              chevron={false}
              align="end"
            />
            <AdminMenu
              options={assignees}
              value={assignee}
              onChange={setAssignee}
              label="Assigned"
              showValue={assignee !== 'any'}
              icon={<User {...I} />}
              chevron={false}
              align="end"
            />
          </>
        }
      />

      {view === 'board' ? (
        <AdminContent flush>
          <div ref={board} className="minui-adm-board" data-more={more ? '' : undefined}>
            {columns.map((column) => (
              <CaseColumn
                key={column.id}
                column={column}
                count={showCount}
                items={visible.filter((item) => item.status === column.id)}
                dragging={dragging}
                onDragCard={setDragging}
                onDropCard={move}
                onOpen={onOpen}
              />
            ))}
          </div>
        </AdminContent>
      ) : (
        <AdminContent>
          <AdminTable
            rows={visible}
            columns={[
              {
                id: 'name',
                label: 'Client',
                render: (row) => (
                  <>
                    <AdminAvatar size={22} name={row.name} src={row.src} color={row.color} />
                    {row.name}
                  </>
                ),
              },
              { id: 'type', label: 'Type', render: (row) => <AdminTag>{row.type}</AdminTag> },
              { id: 'id', label: 'Case' },
              {
                id: 'status',
                label: 'Stage',
                render: (row) => (
                  <AdminStatus dot tone={statusOf(row)?.tone}>
                    {statusOf(row)?.label}
                  </AdminStatus>
                ),
              },
              { id: 'advocate', label: 'Advocate' },
              {
                id: 'hours',
                label: 'Updated',
                render: (row) => (
                  <span
                    data-tone={row.overdue ? 'orange' : undefined}
                    style={row.overdue ? { color: 'var(--adm-tone)' } : undefined}
                  >
                    {timeAgo(row.hours)}
                  </span>
                ),
              },
            ]}
            empty={
              <AdminEmpty
                icon={<SearchX {...I} />}
                title="No cases found"
                text="Try another search or clear the filters."
              />
            }
          />
        </AdminContent>
      )}
    </AdminShell>
  );
}
