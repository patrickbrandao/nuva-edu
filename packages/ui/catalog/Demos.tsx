import {
  BadgeCheck,
  Bell,
  BookOpen,
  GraduationCap,
  House,
  LayoutDashboard,
  Receipt,
  Store,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  AdminBreadcrumb,
  AdminButton,
  AdminCard,
  AdminContent,
  AdminDetails,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  AdminSidebar,
  AdminTopbar,
  ClassroomShell,
  ErrorState,
  type LinkComponent,
  LinkProvider,
  LoadingState,
  PageTitle,
  ShellFooter,
  type ThemeMode,
  ThemeSwitch,
  useTheme,
} from '../src/index';

/*
 * Demonstrações de página inteira das duas cascas, abertas pelo catálogo em
 * `?demo=classroom` e `?demo=admin`. Com `&theme=light|dark` o tema é fixo (é assim
 * que o catálogo as mostra lado a lado, em molduras estreitas, com o menu em gaveta).
 */

/** Faz o papel do roteador: o link troca a "página" sem recarregar. */
const NavigateContext = createContext<(path: string) => void>(() => {});

const FakeRouterLink: LinkComponent = ({ href, onClick, ...rest }) => {
  const navigate = useContext(NavigateContext);
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        navigate(href);
      }}
    />
  );
};

function FakeRouter({
  onNavigate,
  children,
}: {
  onNavigate: (path: string) => void;
  children: ReactNode;
}) {
  return (
    <NavigateContext.Provider value={onNavigate}>
      <LinkProvider component={FakeRouterLink}>{children}</LinkProvider>
    </NavigateContext.Provider>
  );
}

function DemoTheme({ fixed }: { fixed: ThemeMode | null }) {
  const [mode, setMode] = useTheme();
  if (fixed) return null;
  return <ThemeSwitch compact mode={mode} onChange={setMode} />;
}

const FOOTER_LINKS = [
  { id: 'termos', label: 'Termos de uso', href: '/termos' },
  { id: 'privacidade', label: 'Privacidade', href: '/privacidade' },
  {
    id: 'codigo',
    label: 'Código-fonte',
    href: 'https://github.com/patrickbrandao/nuva-edu',
    external: true,
  },
];

const ROOM_GROUPS = [
  {
    id: 'explorar',
    label: 'Explorar',
    items: [
      { id: 'vitrine', label: 'Vitrine', href: '/', icon: <Store aria-hidden="true" /> },
      { id: 'planos', label: 'Planos', href: '/planos', icon: <BadgeCheck aria-hidden="true" /> },
    ],
  },
  {
    id: 'aprendizado',
    label: 'Aprendizado',
    items: [
      { id: 'inicio', label: 'Início', href: '/inicio', icon: <House aria-hidden="true" /> },
      {
        id: 'cursos',
        label: 'Meus cursos',
        href: '/meus-cursos',
        icon: <GraduationCap aria-hidden="true" />,
      },
      {
        id: 'ebooks',
        label: 'Meus ebooks',
        href: '/meus-ebooks',
        icon: <BookOpen aria-hidden="true" />,
      },
    ],
  },
  {
    id: 'conta',
    label: 'Conta',
    items: [
      {
        id: 'compras',
        label: 'Compras',
        href: '/conta/compras',
        icon: <Receipt aria-hidden="true" />,
      },
    ],
  },
];

const ROOM_ITEMS = ROOM_GROUPS.flatMap((group) => group.items);

function PageBody({ title }: { title: string }) {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  return (
    <div className="demo__page">
      <PageTitle subtitle="Demonstração da casca, com os três estados de uma área.">
        {title}
      </PageTitle>
      <div className="cat__row">
        <AdminButton onClick={() => setState('loading')}>Carregando</AdminButton>
        <AdminButton onClick={() => setState('error')}>Erro</AdminButton>
        <AdminButton onClick={() => setState('ready')}>Pronto</AdminButton>
      </div>
      <AdminCard pad>
        {state === 'loading' ? (
          <LoadingState label="Carregando os dados da escola…" />
        ) : state === 'error' ? (
          <ErrorState
            title="Não foi possível carregar"
            text="Confira a conexão e tente de novo."
            detail="Requisição 01JD2-EXEMPLO"
            retryLabel="Tentar de novo"
            onRetry={() => setState('ready')}
          />
        ) : (
          <AdminDetails
            wrap
            items={[
              { label: 'Escola', value: 'Escola Aurora' },
              { label: 'Versão', value: '1.2.3' },
              {
                label: 'Entrada',
                value: 'E-mail e senha, Google, GitHub, Microsoft e conta da empresa',
              },
            ]}
          />
        )}
      </AdminCard>
    </div>
  );
}

function ClassroomDemo({ fixed }: { fixed: ThemeMode | null }) {
  const [path, setPath] = useState('/planos');
  const current = ROOM_ITEMS.find((item) => item.href === path);
  const title = current?.label ?? 'Página';
  return (
    <FakeRouter onNavigate={setPath}>
      <ClassroomShell
        brand={{ name: 'Escola Aurora', href: '/' }}
        groups={ROOM_GROUPS}
        active={current?.id}
        crumbs={
          path === '/'
            ? [{ label: 'Vitrine' }]
            : [{ label: 'Vitrine', href: '/' }, { label: title }]
        }
        announcement={`Página ${title}`}
        labels={{
          skipToContent: 'Ir para o conteúdo',
          menu: 'Menu principal',
          openMenu: 'Abrir o menu',
          closeMenu: 'Fechar o menu',
          collapseMenu: 'Recolher o menu',
          expandMenu: 'Expandir o menu',
          breadcrumb: 'Você está em',
        }}
        actions={
          <>
            <DemoTheme fixed={fixed} />
            <AdminButton
              variant="ghost"
              icon={<Bell aria-hidden="true" />}
              aria-label="Notificações"
            />
            <AdminButton href="/entrar" variant="primary">
              Entrar
            </AdminButton>
          </>
        }
        footer={
          <ShellFooter links={FOOTER_LINKS} newTabLabel="(abre em nova aba)">
            Escola Aurora · versão 1.2.3
          </ShellFooter>
        }
      >
        <PageBody title={title} />
      </ClassroomShell>
    </FakeRouter>
  );
}

const ADMIN_SECTIONS = [
  {
    id: 'geral',
    label: 'Visão geral',
    items: [
      { id: 'painel', label: 'Painel', href: '/', icon: <LayoutDashboard aria-hidden="true" /> },
    ],
  },
  {
    id: 'pessoas',
    label: 'Pessoas',
    items: [
      {
        id: 'alunos',
        label: 'Alunos',
        href: '/alunos',
        icon: <Users aria-hidden="true" />,
        badge: 4,
      },
      { id: 'cursos', label: 'Cursos', href: '/cursos', icon: <BookOpen aria-hidden="true" /> },
    ],
  },
];

const ADMIN_ITEMS = ADMIN_SECTIONS.flatMap((section) => section.items);

function AdminDemo({ fixed }: { fixed: ThemeMode | null }) {
  const [path, setPath] = useState('/alunos');
  const current = ADMIN_ITEMS.find((item) => item.href === path);
  const title = current?.label ?? 'Página';
  return (
    <FakeRouter onNavigate={setPath}>
      <AdminShell
        fullPage
        drawerBelow={1024}
        sidebar={
          <AdminSidebar
            brand={{ name: 'Escola Aurora', mark: <GraduationCap size={20} aria-hidden="true" /> }}
            sections={ADMIN_SECTIONS}
            active={current?.id}
            navLabel="Menu principal"
            user={{ name: 'Rita Alves', role: 'Administradora' }}
          />
        }
      >
        <AdminTopbar actions={<DemoTheme fixed={fixed} />}>
          <AdminBreadcrumb
            label="Você está em"
            items={
              path === '/'
                ? [{ label: 'Painel' }]
                : [{ label: 'Painel', href: '/' }, { label: title }]
            }
          />
        </AdminTopbar>
        <AdminContent>
          <AdminPageHeader
            title={title}
            subtitle="Janela em página inteira, com o menu em gaveta."
          />
          <AdminSection title="Estados">
            <PageBody title={title} />
          </AdminSection>
        </AdminContent>
        <ShellFooter links={FOOTER_LINKS.slice(2)} newTabLabel="(abre em nova aba)">
          Versão 1.2.3
        </ShellFooter>
      </AdminShell>
    </FakeRouter>
  );
}

/** Página de demonstração escolhida pelo endereço; `null` quando é o catálogo. */
export function Demo({ name, theme }: { name: string; theme: string | null }) {
  const fixed: ThemeMode | null = theme === 'light' || theme === 'dark' ? theme : null;
  // Tema fixo: só marca <html>, sem gravar (as molduras dividem o armazenamento com o catálogo).
  useEffect(() => {
    if (fixed) document.documentElement.setAttribute('data-theme', fixed);
  }, [fixed]);
  if (name === 'classroom') return <ClassroomDemo fixed={fixed} />;
  if (name === 'admin') return <AdminDemo fixed={fixed} />;
  return null;
}
