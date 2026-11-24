import { BookOpen, Inbox, Plus, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActionButton,
  AdminAvatars,
  AdminBadge,
  AdminButton,
  AdminCard,
  AdminCheckbox,
  AdminEmpty,
  AdminField,
  AdminList,
  AdminMenu,
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
  Badge,
  CasesBoard,
  ClientOverview,
  DiffBlocks,
  Dot,
  Field,
  LabelPill,
  MarketingWaitlist,
  PricingPage,
  Resolved,
  SnippetCard,
  SnippetGrid,
  Surface,
  ThemeSwitch,
  Txt,
  useTheme,
} from '../src/index';
import './catalog.css';

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
    </div>
  );
}
