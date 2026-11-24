import {
  Archive,
  Bell,
  BookOpen,
  CircleCheck,
  CircleDashed,
  CircleUser,
  CircleX,
  Clock,
  ClockFading,
  Contact,
  Copy,
  Ellipsis,
  Feather,
  Globe,
  LayoutGrid,
  Mail,
  Megaphone,
  Pencil,
  Plus,
  Rocket,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { AdminButton, AdminMenu } from './AdminControls';
import {
  AdminAvatar,
  AdminCard,
  AdminDetails,
  AdminList,
  AdminMessages,
  AdminPageHeader,
  AdminSection,
  AdminStats,
  AdminStatus,
  AdminTimeline,
} from './AdminData';
import { AdminBreadcrumb, AdminContent, AdminShell, AdminSidebar, AdminTopbar } from './AdminShell';

/*
 * Visão de um cliente ("Clients › QuantumCraft Labs"): o painel em tom quente
 * com o menu em árvore, a trilha no topo, o cabeçalho com as ações, quatro
 * blocos numéricos e duas colunas — à esquerda as campanhas, a cobertura
 * recente e a atividade; à direita os detalhes e as mensagens.
 * Tudo HTML, CSS e SVG, nos dois temas.
 */

const I = { strokeWidth: 1.75, 'aria-hidden': true };

export const CLIENT_BRAND = {
  name: 'Presswell',
  mark: <Feather size={19} strokeWidth={2} fill="currentColor" fillOpacity={0.9} />,
};

/** O menu lateral, com os subitens de "All Campaigns". */
export const CLIENT_NAV = [
  {
    id: 'main',
    items: [
      {
        id: 'campaigns',
        label: 'All Campaigns',
        icon: <Megaphone {...I} />,
        children: [
          { id: 'campaigns-draft', label: 'Draft', icon: <CircleDashed {...I} /> },
          { id: 'campaigns-review', label: 'Client Review', icon: <ClockFading {...I} /> },
          { id: 'campaigns-active', label: 'Active', icon: <CircleCheck {...I} /> },
          { id: 'campaigns-closed', label: 'Closed', icon: <CircleX {...I} /> },
        ],
      },
      { id: 'stories', label: 'Stories', icon: <BookOpen {...I} /> },
      { id: 'clients', label: 'Clients', icon: <Users {...I} /> },
      { id: 'press-contacts', label: 'Press Contacts', icon: <Contact {...I} /> },
      { id: 'directory', label: 'Directory', icon: <LayoutGrid {...I} /> },
      { id: 'settings', label: 'Settings', icon: <Settings {...I} /> },
    ],
  },
];

export const CLIENT_USER = { name: 'Steven M.' };

export const CLIENT = { name: 'QuantumCraft Labs', industry: 'Healthcare' };

export const CLIENT_STATS = [
  { value: 3, label: 'Active Campaigns' },
  { value: 2, label: 'Draft Campaigns' },
  { value: 24, label: 'Coverage This Month' },
  { value: 78, label: 'PR Health Score', tone: 'green' },
];

export const CLIENT_CAMPAIGNS = [
  {
    id: 'summit',
    name: 'Financial Services Summit',
    dates: 'Jan 15, 2025 - Feb 15, 2025',
    status: 'Active',
  },
  { id: 'q2', name: 'Q2 PR Campaign', dates: 'May 20, 2025 - May 21, 2025', status: 'Active' },
  {
    id: 'eco',
    name: 'Eco-Friendly Initiative',
    dates: 'Apr 5, 2025 - Apr 7, 2025',
    status: 'Active',
  },
  {
    id: 'sustainable',
    name: 'Sustainable Products Campaign',
    dates: 'Feb 20, 2025',
    status: 'Draft',
  },
  { id: 'expo', name: 'Consumer Tech Expo', dates: 'May 30, 2025', status: 'Draft' },
];

/** A cor de cada estado de campanha. */
export const CAMPAIGN_TONES = {
  Active: 'green',
  Draft: 'amber',
  'Client Review': 'blue',
  Closed: 'gray',
};

export const CLIENT_COVERAGE = [
  {
    id: 'tc',
    outlet: 'TechCrunch',
    initials: 'TC',
    color: '#12a150',
    title: 'QuantumCraft’s AI Breakthrough',
    reach: '1.2M',
    when: '2 days ago',
  },
  {
    id: 'hw',
    outlet: 'Healthcare Weekly',
    initials: 'HW',
    color: '#1c2b5a',
    title: 'Startups to Watch',
    reach: '320K',
    when: '5 days ago',
  },
  {
    id: 'md',
    outlet: 'Medium',
    initials: 'M',
    color: '#111111',
    title: 'Generative AI for Beginners',
    reach: '150K',
    when: '7 days ago',
  },
];

export const CLIENT_ACTIVITY = [
  {
    id: 'coverage',
    icon: <Rocket {...I} />,
    text: (
      <>
        <strong>Coverage</strong> published <strong>in TechCrunch</strong>
      </>
    ),
    time: 'Today 11:00 am',
  },
  {
    id: 'pitch',
    icon: <Mail {...I} />,
    text: (
      <>
        <strong>Pitch</strong> sent to <strong>6 journalists</strong>
      </>
    ),
    time: 'Dec 20, 2025 9:45 pm',
  },
  {
    id: 'approved',
    icon: <CircleCheck {...I} />,
    text: (
      <>
        <strong>Campaign</strong> approved by <strong>client</strong>
      </>
    ),
    time: 'Dec 20, 2025 9:45 pm',
  },
];

export const CLIENT_DETAILS = [
  { label: 'Website', icon: <Globe {...I} />, value: 'quantumcraftlabs.com' },
  { label: 'Timezone', icon: <Clock {...I} />, value: 'PST' },
  { label: 'Owner', icon: <CircleUser {...I} />, value: 'Jane Cooper' },
  { label: 'Journalists', icon: <Contact {...I} />, value: '128' },
];

export const CLIENT_MESSAGES = [
  {
    id: 'kathryn',
    name: 'Kathryn Murphy',
    time: '2 mins ago',
    text: 'AI that accelerates patient outcomes...',
  },
  {
    id: 'brooklyn',
    name: 'Brooklyn Simmons',
    time: 'Yesterday',
    text: 'Built for enterprise healthcare systems...',
  },
];

const MORE = [
  { id: 'duplicate', label: 'Duplicate', icon: <Copy {...I} /> },
  { id: 'archive', label: 'Archive', icon: <Archive {...I} /> },
  'separator',
  { id: 'delete', label: 'Delete client', icon: <Trash2 {...I} />, danger: true },
];

/** O cartão de uma campanha: nome, datas e o estado colorido. */
export function CampaignCard({ campaign, onOpen }) {
  return (
    <AdminCard
      as={onOpen ? 'button' : 'div'}
      type={onOpen ? 'button' : undefined}
      interactive={!!onOpen}
      className="minui-adm-campaign"
      onClick={onOpen ? () => onOpen(campaign) : undefined}
    >
      <strong>{campaign.name}</strong>
      <span className="minui-adm-campaign__line">
        <span>{campaign.dates}</span>
        <span className="minui-adm-sep" aria-hidden="true" />
        <AdminStatus tone={CAMPAIGN_TONES[campaign.status] ?? 'gray'}>
          {campaign.status}
        </AdminStatus>
      </span>
    </AdminCard>
  );
}

/**
 * A página inteira. `onAction(id)` recebe 'edit', 'new-campaign' e as opções
 * do menu "…" ('duplicate', 'archive', 'delete'); `onOpenCampaign(campanha)` e
 * `onOpenMessage(mensagem)` os cliques nos cartões; `onNavigate(id, item)` os
 * do menu lateral e da trilha ('clients').
 */
export function ClientOverview({
  brand = CLIENT_BRAND,
  nav = CLIENT_NAV,
  user = CLIENT_USER,
  client = CLIENT,
  stats = CLIENT_STATS,
  campaigns = CLIENT_CAMPAIGNS,
  coverage = CLIENT_COVERAGE,
  activity = CLIENT_ACTIVITY,
  details = CLIENT_DETAILS,
  messages = CLIENT_MESSAGES,
  defaultActive = 'clients',
  onNavigate,
  onAction,
  onOpenCampaign,
  onOpenMessage,
  height = 780,
  className,
  style,
}) {
  const [active, setActive] = useState(defaultActive);
  const navigate = (id, item) => {
    setActive(id);
    onNavigate?.(id, item);
  };

  return (
    <AdminShell
      tone="warm"
      height={height}
      className={className}
      style={style}
      sidebar={
        <AdminSidebar
          flat
          brand={brand}
          sections={nav}
          user={user}
          userAction={
            <AdminButton
              variant="ghost"
              size="sm"
              icon={<Bell {...I} />}
              aria-label="Notifications"
              onClick={() => onAction?.('notifications')}
            />
          }
          active={active}
          onNavigate={navigate}
        />
      }
    >
      <AdminTopbar>
        <AdminBreadcrumb
          items={[
            {
              label: 'Clients',
              icon: <Users size={16} {...I} />,
              onClick: () => navigate('clients'),
            },
            { label: client.name, icon: <AdminAvatar soft size={18} name={client.name} /> },
          ]}
        />
      </AdminTopbar>

      <AdminContent>
        <AdminPageHeader
          title={client.name}
          subtitle={client.industry}
          actions={
            <>
              <AdminButton icon={<Pencil {...I} />} onClick={() => onAction?.('edit')}>
                Edit
              </AdminButton>
              <AdminButton
                variant="primary"
                icon={<Plus {...I} strokeWidth={2} />}
                onClick={() => onAction?.('new-campaign')}
              >
                New Campaign
              </AdminButton>
              <AdminMenu
                options={MORE}
                icon={<Ellipsis {...I} />}
                aria-label="More actions"
                align="end"
                onChange={(id) => onAction?.(id)}
              />
            </>
          }
        />

        <AdminStats stats={stats} className="minui-adm-client__stats" />

        <div className="minui-adm-client__body">
          <div className="minui-adm-client__left">
            <AdminSection title="Campaigns">
              <div className="minui-adm-campaigns">
                {campaigns.map((campaign) => (
                  <CampaignCard key={campaign.id} campaign={campaign} onOpen={onOpenCampaign} />
                ))}
              </div>
            </AdminSection>

            <AdminSection title="Recent Coverage">
              <AdminList
                items={coverage.map((entry) => ({
                  id: entry.id,
                  icon: (
                    <AdminAvatar
                      square
                      size={16}
                      name={entry.outlet}
                      initials={entry.initials}
                      color={entry.color}
                    />
                  ),
                  title: entry.outlet,
                  text: entry.title,
                  aside: [`Reach ${entry.reach}`, entry.when],
                }))}
              />
            </AdminSection>

            <AdminSection title="Activity">
              <AdminTimeline items={activity} />
            </AdminSection>
          </div>

          <aside className="minui-adm-client__right">
            <AdminSection title="Client Details">
              <AdminDetails items={details} />
            </AdminSection>

            <AdminSection title="Recent Messages">
              <AdminMessages messages={messages} onOpen={onOpenMessage} />
            </AdminSection>
          </aside>
        </div>
      </AdminContent>
    </AdminShell>
  );
}
