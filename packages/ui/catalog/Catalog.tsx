import { BookOpen, Inbox, Plus, UserPlus } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import {
  ActionButton,
  ActivityHeatmap,
  AdminAvatar,
  AdminAvatars,
  AdminBadge,
  AdminButton,
  AdminCard,
  AdminCheckbox,
  AdminDetails,
  AdminEmpty,
  AdminField,
  AdminList,
  AdminMenu,
  AdminNav,
  AdminScope,
  AdminSearch,
  AdminStats,
  AdminStatus,
  AdminSwitch,
  AdminTable,
  AdminTabs,
  AdminTag,
  AdminTimeline,
  Avatar,
  accentOn,
  accentText,
  Badge,
  CasesBoard,
  ClientOverview,
  contrastRatio,
  DiffBlocks,
  Dot,
  ErrorState,
  Field,
  LabelPill,
  LoadingState,
  MarketingWaitlist,
  PageTitle,
  PricingPage,
  Resolved,
  SnippetCard,
  SnippetGrid,
  Surface,
  TextLink,
  ThemeSwitch,
  Txt,
  useTheme,
  VideoPlayer,
} from '../src/index';
import './catalog.css';
import { FeedbackPieces } from './FeedbackPieces';

const HEATMAP_SAMPLE = Array.from({ length: 120 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 10, 25) - i * 3 * 86_400_000).toISOString().slice(0, 10),
  total: (i * 7) % 5,
}));

const PLANS = [
  {
    id: 'mensal',
    name: 'Mensal',
    price: { monthly: 49, yearly: 39 },
    description: 'Acesso a todos os cursos enquanto a assinatura estiver ativa.',
    cta: 'Assinar',
    features: ['Todos os cursos', 'Fórum e comunidade', 'Certificados'],
  },
  {
    id: 'pro',
    name: 'Pro',
    badge: 'Mais escolhido',
    featured: true,
    price: { monthly: 89, yearly: 71 },
    description: 'Tudo do plano Mensal, com ebooks e eventos ao vivo.',
    cta: 'Assinar o Pro',
    features: ['Tudo do Mensal', 'Ebooks incluídos', 'Eventos ao vivo', 'Suporte prioritário'],
  },
];

const ROWS = [
  { id: '1', name: 'Ana Souza', email: 'ana@example.com', status: 'Ativa' },
  { id: '2', name: 'Bruno Lima', email: 'bruno@example.com', status: 'Pendente' },
];

/** Mostra o mesmo conteúdo nos dois temas, lado a lado, seja qual for o tema da página. */
function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="cat__pair">
      <div className="cat__pane" data-theme="light" data-testid="pane-light">
        <h3>Claro</h3>
        {children}
      </div>
      <div className="cat__pane" data-theme="dark" data-testid="pane-dark">
        <h3>Escuro</h3>
        {children}
      </div>
    </div>
  );
}

function Primitives() {
  return (
    <>
      <div className="cat__row">
        <Surface width={300} height={118} radius={14}>
          <Txt x={14} y={28} size={13} weight={600} color="var(--minui-text)">
            Aula publicada
          </Txt>
          <Txt x={14} y={48} size={12.5} color="var(--minui-text-soft)">
            Módulo 2 · Introdução ao SQL
          </Txt>
          <Field x={12} y={78} width={276} height={26} placeholder="Responder…" />
        </Surface>
        <Surface width={200} height={118} radius={16} tone="panel">
          <Txt x={14} y={28} size={13} weight={600} color="var(--minui-text)">
            Painel
          </Txt>
          <Resolved text="Concluído" />
        </Surface>
      </div>
      <div className="cat__row">
        <Avatar name="Ana Souza" size={36} />
        <Avatar name="Bruno Lima" size={36} round />
        <span style={{ position: 'relative', width: 30, height: 20 }}>
          <Badge count={3} cx={15} cy={10} />
        </span>
        <span style={{ position: 'relative', width: 12, height: 12 }}>
          <Dot color="var(--minui-green)" cx={6} cy={6} />
        </span>
        <LabelPill label="bug" />
        <LabelPill label="dúvida" hue={200} />
        <ActionButton>Recusar</ActionButton>
        <ActionButton tone="primary">Aceitar</ActionButton>
        <DiffBlocks added={3} removed={1} />
      </div>
    </>
  );
}

function AdminPieces() {
  const [tab, setTab] = useState('todos');
  const [order, setOrder] = useState('recentes');
  const [query, setQuery] = useState('');
  const [notify, setNotify] = useState(true);
  const [agree, setAgree] = useState(false);
  return (
    <AdminScope className="cat__stack">
      <div className="cat__row">
        <AdminButton variant="primary" icon={<Plus />}>
          Novo curso
        </AdminButton>
        <AdminButton>Exportar</AdminButton>
        <AdminButton variant="ghost">Cancelar</AdminButton>
        <AdminSearch value={query} onChange={setQuery} placeholder="Buscar aluno…" />
        <AdminMenu
          value={order}
          onChange={setOrder}
          options={[
            { id: 'recentes', label: 'Mais recentes' },
            { id: 'nome', label: 'Por nome' },
          ]}
        />
      </div>
      <AdminTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'todos', label: 'Todos', count: 12 },
          { id: 'ativos', label: 'Ativos', count: 9 },
        ]}
      />
      <div className="cat__row">
        <AdminField label="E-mail" hint="Usado no login" placeholder="aluno@example.com" />
        <AdminField label="Cupom" error="Cupom inválido" defaultValue="NUVA10" />
      </div>
      <div className="cat__row">
        <AdminCheckbox checked={agree} onChange={setAgree}>
          Aceito os termos
        </AdminCheckbox>
        <AdminSwitch checked={notify} onChange={setNotify}>
          Notificações
        </AdminSwitch>
        <AdminTag>Curso</AdminTag>
        <AdminBadge>4</AdminBadge>
        <AdminStatus tone="green">Ativa</AdminStatus>
        <AdminStatus tone="amber" dot>
          Pendente
        </AdminStatus>
        <AdminAvatars
          people={[{ name: 'Ana Souza' }, { name: 'Bruno Lima' }, { name: 'Caio Reis' }]}
        />
      </div>
      <AdminStats
        stats={[
          { value: 'R$ 12.480', label: 'Vendas do mês' },
          { value: '37', label: 'Novos alunos', tone: 'green' },
          { value: '5', label: 'Chamados abertos', tone: 'amber' },
        ]}
      />
      <AdminTable
        columns={[
          { id: 'name', label: 'Nome' },
          { id: 'email', label: 'E-mail' },
          { id: 'status', label: 'Assinatura' },
        ]}
        rows={ROWS}
      />
      <AdminCard pad>
        <AdminList
          items={[
            {
              id: 'a',
              icon: <BookOpen />,
              title: 'SQL do zero',
              text: '12 aulas',
              aside: ['Publicado'],
            },
            {
              id: 'b',
              icon: <BookOpen />,
              title: 'Docker na prática',
              text: '8 aulas',
              aside: ['Rascunho'],
            },
          ]}
        />
      </AdminCard>
      <AdminTimeline
        items={[
          { id: 't1', icon: <UserPlus />, text: 'Ana Souza se cadastrou', time: 'há 2 horas' },
          { id: 't2', icon: <BookOpen />, text: 'Aula "Joins" publicada', time: 'ontem' },
        ]}
      />
      <AdminTable
        columns={[{ id: 'name', label: 'Nome' }]}
        rows={[]}
        empty={
          <AdminEmpty
            icon={<Inbox />}
            title="Nenhum chamado"
            text="Quando alguém pedir ajuda, aparece aqui."
          >
            <AdminButton variant="primary">Abrir chamado</AdminButton>
          </AdminEmpty>
        }
      />
    </AdminScope>
  );
}

const LONG_DETAILS = [
  { label: 'Escola', value: 'Escola Aurora' },
  {
    label: 'Entrada',
    value: 'E-mail e senha, Google, GitHub, Microsoft e conta da empresa (SAML)',
  },
];

function FlowPieces() {
  const [tries, setTries] = useState(0);
  return (
    <AdminScope className="cat__stack">
      <PageTitle subtitle="Frase de apoio do título de página.">Meus cursos</PageTitle>
      <p style={{ margin: 0 }}>
        Texto com um <TextLink href="/termos">link interno</TextLink>, um{' '}
        <TextLink href="/privacidade" quiet>
          link discreto
        </TextLink>{' '}
        e um{' '}
        <TextLink href="https://example.com" external newTabLabel="(abre em nova aba)">
          link externo
        </TextLink>
        .
      </p>
      <AdminCard pad>
        <LoadingState label="Carregando os cursos…" />
      </AdminCard>
      <LoadingState inline label="Salvando…" />
      <AdminCard>
        <ErrorState
          title="Não foi possível carregar"
          text="Confira a conexão e tente de novo."
          detail={`Requisição 01JD2-EXEMPLO · tentativas: ${tries}`}
          retryLabel="Tentar de novo"
          onRetry={() => setTries(tries + 1)}
        />
      </AdminCard>
      <AdminCard>
        <AdminEmpty icon={<Inbox />} text="AdminEmpty sem título: só o ícone e a frase." />
      </AdminCard>
      <div style={{ maxWidth: 320 }} className="cat__stack">
        <AdminCard pad>
          <AdminDetails items={LONG_DETAILS} />
        </AdminCard>
        <AdminCard pad>
          <AdminDetails wrap items={LONG_DETAILS} />
        </AdminCard>
      </div>
    </AdminScope>
  );
}

/** Cores de exemplo da escola: clara, média e escura (as mesmas de src/accent/accent.test.ts). */
const ACCENTS = [
  { id: 'clara', label: 'Clara', color: '#ffd166' },
  { id: 'media', label: 'Média', color: '#2563eb' },
  { id: 'escura', label: 'Escura', color: '#1e3a5f' },
];

const ACCENT_NAV = [
  {
    id: 'menu',
    items: [
      { id: 'cursos', label: 'Cursos', icon: <BookOpen aria-hidden="true" /> },
      { id: 'caixa', label: 'Caixa de entrada', icon: <Inbox aria-hidden="true" /> },
    ],
  },
];

const ratio = (a: string, b: string): string => `${contrastRatio(a, b).toFixed(1)}:1`;

/**
 * O que muda com `--minui-accent`: botão primário, caixas marcadas, link, foco (inclusive o do
 * seletor de tema), iniciais da marca e item atual. Os dois últimos avatares não são a marca:
 * ficam na cor do nome, com a inicial em branco ou preto conforme o fundo.
 */
function AccentSample({ color, theme }: { color: string | null; theme: 'light' | 'dark' }) {
  // como nos sites, a cor entra por uma variável CSS; os derivados são refeitos no AdminScope
  const scope = color ? ({ '--minui-accent': color } as CSSProperties) : undefined;
  return (
    <div className="cat__accent" data-accent={color ?? 'padrao'} style={scope}>
      <AdminScope className="cat__stack">
        <div className="cat__row">
          <AdminButton variant="primary" icon={<Plus />}>
            Matricular
          </AdminButton>
          <AdminCheckbox checked onChange={() => {}}>
            Marcada
          </AdminCheckbox>
          <AdminSwitch checked onChange={() => {}}>
            Ligado
          </AdminSwitch>
          <TextLink href="/termos">Link de texto</TextLink>
        </div>
        <div className="cat__row">
          {/* o anel de foco do seletor (Tab) e as iniciais da marca seguem a cor */}
          <ThemeSwitch compact mode={theme} onChange={() => {}} />
          <AdminAvatar square accent size={24} name="Escola Aurora" />
          <AdminAvatar square size={24} name="Escola Aurora" />
          <AdminAvatar square size={24} name="Escola 7" />
        </div>
        <div style={{ maxWidth: 220 }}>
          <AdminNav sections={ACCENT_NAV} active="cursos" />
        </div>
        <p className="cat__note">
          {color
            ? `${color}: texto ${accentOn(color)} sobre a cor (${ratio(accentOn(color), color)}); como texto vira ${accentText(color, theme)}.`
            : 'Sem --minui-accent: o padrão neutro de sempre.'}
        </p>
      </AdminScope>
    </div>
  );
}

function AccentSamples() {
  return (
    <div className="cat__pair">
      {(['light', 'dark'] as const).map((theme) => (
        <div key={theme} className="cat__pane" data-theme={theme} data-testid={`accent-${theme}`}>
          <h3>{theme === 'light' ? 'Claro' : 'Escuro'}</h3>
          <div className="cat__stack">
            <AccentSample color={null} theme={theme} />
            {ACCENTS.map((accent) => (
              <AccentSample key={accent.id} color={accent.color} theme={theme} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** As duas cascas em molduras estreitas (menu em gaveta), uma por tema. */
function ShellFrames({
  demo,
  title,
  accent,
}: {
  demo: string;
  title: string;
  accent?: string | undefined;
}) {
  const query = accent ? `&accent=${encodeURIComponent(accent)}` : '';
  return (
    <div className="cat__pair">
      {(['light', 'dark'] as const).map((theme) => (
        <div key={theme} className="cat__pane">
          <h3>{theme === 'light' ? 'Claro' : 'Escuro'}</h3>
          <iframe
            className="cat__device"
            title={`${title}, tema ${theme === 'light' ? 'claro' : 'escuro'}`}
            src={`?demo=${demo}&theme=${theme}${query}`}
          />
        </div>
      ))}
    </div>
  );
}

export function Catalog() {
  const [mode, setMode, active] = useTheme();
  return (
    <div className="cat">
      <header className="cat__top">
        <h1>
          Catálogo @nuva-edu/ui <small>tema em uso: {active === 'dark' ? 'escuro' : 'claro'}</small>
        </h1>
        <ThemeSwitch mode={mode} onChange={setMode} />
      </header>

      <section>
        <h2>Primitivos</h2>
        <p className="cat__note">
          Surface, Txt, Field, Avatar, Badge, Dot, LabelPill, ActionButton, DiffBlocks, Resolved.
        </p>
        <Pair>
          <Primitives />
        </Pair>
      </section>

      <section>
        <h2>Controles e dados do painel</h2>
        <p className="cat__note">AdminControls e AdminData dentro de um AdminScope.</p>
        <Pair>
          <AdminPieces />
        </Pair>
      </section>

      <section>
        <h2>Cor de destaque da escola</h2>
        <p className="cat__note">
          <code>--minui-accent</code> (spec 006, RF-06) com três cores de exemplo. O texto sobre a
          cor é branco ou preto conforme a luminância; como link, ícone ou foco a cor é ajustada ao
          tema. Regra em <code>src/styles/tokens.css</code>.
        </p>
        <AccentSamples />
        <p className="cat__note" style={{ marginTop: 16 }}>
          Nas cascas (360 px), com a cor aplicada em <code>&lt;html&gt;</code> como nos sites:{' '}
          <a href="?demo=classroom&accent=%232563eb">aluno</a> e{' '}
          <a href="?demo=admin&accent=%232563eb">painel</a> em página inteira; troque{' '}
          <code>accent</code> no endereço para testar outra cor.
        </p>
        <div className="cat__stack">
          <ShellFrames
            demo="classroom"
            title="Casca do aluno com cor de destaque"
            accent="#2563eb"
          />
          <ShellFrames demo="admin" title="Casca do painel com cor de destaque" accent="#ffd166" />
        </div>
      </section>

      <section>
        <h2>Fluxo e estados</h2>
        <p className="cat__note">
          PageTitle, TextLink, LoadingState, ErrorState, AdminEmpty sem título e AdminDetails sem e
          com <code>wrap</code>.
        </p>
        <Pair>
          <FlowPieces />
        </Pair>
      </section>

      <section>
        <h2>Avisos, diálogos e formulário</h2>
        <p className="cat__note">
          Alert (em linha e em faixa), Dialog, ConfirmDialog (com o nome do item e digitação),
          ToastProvider com useToast, PasswordInput, AdminTextArea e ImagePicker (prévia quadrada,
          até 5 MB).
        </p>
        <Pair>
          <FeedbackPieces />
        </Pair>
      </section>

      <section>
        <h2>Casca do aluno</h2>
        <p className="cat__note">
          ClassroomShell e ShellFooter em moldura de 360 px (menu em gaveta).{' '}
          <a href="?demo=classroom">Abrir em página inteira</a> para ver a coluna que recolhe.
        </p>
        <ShellFrames demo="classroom" title="Casca do aluno" />
      </section>

      <section>
        <h2>Painel em página inteira</h2>
        <p className="cat__note">
          AdminShell com <code>fullPage</code> e <code>drawerBelow</code>, links pelo LinkProvider.{' '}
          <a href="?demo=admin">Abrir em página inteira</a>.
        </p>
        <ShellFrames demo="admin" title="Painel" />
      </section>

      <section>
        <h2>CasesBoard</h2>
        <p className="cat__note">
          Quadro com a casca administrativa (AdminShell). Segue o tema da página.
        </p>
        <div className="cat__frame">
          <CasesBoard height={640} />
        </div>
      </section>

      <section>
        <h2>ClientOverview</h2>
        <p className="cat__note">Base da ficha do aluno.</p>
        <div className="cat__frame">
          <ClientOverview height={720} />
        </div>
      </section>

      <section>
        <h2>PricingPage</h2>
        <p className="cat__note">Base da tela de planos de assinatura.</p>
        <div className="cat__frame">
          <PricingPage
            plans={PLANS}
            title="Planos"
            lead="Escolha como quer estudar."
            currency="R$ "
            period="/mês"
            billingLabels={{ monthly: 'Mensal', yearly: 'Anual' }}
          />
        </div>
      </section>

      <section>
        <h2>Vitrine</h2>
        <p className="cat__note">MarketingWaitlist e SnippetCard.</p>
        <div className="cat__stack">
          <div className="cat__frame">
            <MarketingWaitlist
              title="Novos cursos a caminho"
              lead="Deixe seu e-mail para saber primeiro."
              placeholder="voce@example.com"
              joinLabel="Quero saber"
              joiningLabel="Enviando…"
              joinedMessage="Pronto! Avisaremos você."
              countLabel="pessoas na lista"
              people={['Ana Souza', 'Bruno Lima', 'Caio Reis']}
              features={[]}
            />
          </div>
          <SnippetGrid>
            <SnippetCard
              tag="curso"
              hue={258}
              description="SQL do zero ao avançado"
              path="/cursos/sql"
            />
            <SnippetCard tag="ebook" hue={140} description="Guia de Docker" path="/ebooks/docker" />
          </SnippetGrid>
        </div>
      </section>
      <section>
        <h2>Aprendizado</h2>
        <p className="cat__note">
          VideoPlayer (aqui com provedor link) e ActivityHeatmap com dados de exemplo.
        </p>
        <div className="cat__stack">
          <VideoPlayer
            src="https://example.com/aula-externa"
            provider="link"
            labels={{
              title: 'Aula de exemplo',
              openVideo: 'Abrir vídeo',
              newTab: '(abre em nova aba)',
              controls: 'Controles do vídeo',
              rewind: 'Voltar 10 s',
              forward: 'Avançar 10 s',
              speed: 'Velocidade',
              volume: 'Volume',
              fullscreen: 'Tela cheia',
              pictureInPicture: 'Imagem sobre imagem',
            }}
          />
          <ActivityHeatmap
            today="2026-11-25"
            days={HEATMAP_SAMPLE}
            labels={{
              title: 'Atividade nos últimos 12 meses',
              day: (date, total) =>
                `${total} ${total === 1 ? 'atividade' : 'atividades'} em ${date}`,
              summary: (total, active) => `${total} atividades em ${active} dias`,
              less: 'Menos',
              more: 'Mais',
            }}
          />
        </div>
      </section>
    </div>
  );
}
