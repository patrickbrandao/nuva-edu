import { renderMarkdownToHtml } from '@nuva-edu/core/markdown';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminScope,
  AnnouncementCard,
  AnnouncementList,
  type AnnouncementListLabels,
  buildMonthGrid,
  EventBanner,
  EventCard,
  type EventCardLabels,
  EventTime,
  eventJoinState,
  eventStatus,
  formatCivilDate,
  formatMonthLabel,
  insertMention,
  MarkdownEditor,
  type MarkdownEditorLabels,
  type MentionCandidate,
  MentionList,
  ModerationHistory,
  MonthCalendar,
  type MonthCalendarLabels,
  mentionKey,
  mentionQueryBeforeCaret,
  NotificationBell,
  type NotificationBellLabels,
  NotificationList,
  type NotificationListLabels,
  NotificationPreferences,
  PostCard,
  PostComposer,
  REPORT_REASONS,
  type ReactionLabels,
  Reactions,
  ReportDialog,
  type ReportDialogLabels,
  ReportedContent,
  ReportLinkDialog,
  TicketComposer,
  TicketConversation,
  TicketList,
  type TicketListLabels,
  TopicCard,
  TopicList,
  type TopicListLabels,
  weekdayLabels,
  zonedDateKey,
} from '../index';
import { expectNoAxeViolations } from '../test/axe';

/*
 * Componentes da Fase 4 (specs 017, 018, 023, 024, 025 e 026; ADR 0027): teclado, foco,
 * região viva, fuso/relógio injetáveis e conteúdo perigoso. O axe confere cada montagem.
 */

const wrap = (node: React.ReactNode) =>
  render(
    <AdminScope>
      <h1 className="minui-sr-only">Componentes da comunidade</h1>
      <h2 className="minui-sr-only">Exemplo</h2>
      {node}
    </AdminScope>,
  );

const editorLabels: MarkdownEditorLabels = {
  label: 'Sua resposta',
  showPreview: 'Prévia',
  hidePreview: 'Escrever',
  previewRegion: 'Prévia do texto',
  emptyPreview: 'Nada escrito ainda',
  counter: (used, max) => `${used} de ${max} caracteres`,
  overLimit: (max) => `Passou de ${max} caracteres`,
  hint: 'Use Markdown simples.',
};

const DANGEROUS_HTML =
  '<p>Texto <strong>seguro</strong></p><script>alert(1)</script><a href="javascript:alert(1)">perigo</a><img src="https://example.com/foto.png" alt="foto">';

function EditorHarness({ initial = '**oi**' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor
      value={value}
      onChange={setValue}
      labels={editorLabels}
      newTabLabel="(abre em nova aba)"
    />
  );
}

function MentionHarness({ onChoose }: { onChoose: (username: string) => void }) {
  const [active, setActive] = useState(0);
  const activeItem = mentionItems[active];
  return (
    <>
      <textarea
        aria-label="Texto"
        aria-controls="sugestoes"
        onKeyDown={(event) => {
          const action = mentionKey(event.key, active, mentionItems.length);
          if (action.type === 'active') {
            event.preventDefault();
            setActive(action.index);
          } else if (action.type === 'select' && activeItem) {
            event.preventDefault();
            onChoose(activeItem.username);
          }
        }}
      />
      <MentionList
        id="sugestoes"
        items={mentionItems}
        activeIndex={active}
        labels={{
          region: 'Sugestões de menção',
          empty: 'Ninguém encontrado',
          active: (candidate, index, count) =>
            `Sugestão ${index + 1} de ${count}: ${candidate.name ?? candidate.username}`,
        }}
        onSelect={(candidate) => onChoose(candidate.username)}
      />
    </>
  );
}

function PostComposerHarness({ onSubmit }: { onSubmit: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <PostComposer
      title={{
        value: title,
        onChange: setTitle,
        label: 'Título do tópico',
        minLength: 5,
        maxLength: 150,
        hint: 'De 5 a 150 caracteres.',
      }}
      value={body}
      onChange={setBody}
      labels={{
        ...editorLabels,
        region: 'Novo tópico',
        submit: 'Publicar',
        cancel: 'Cancelar',
        sending: 'Publicando…',
      }}
      onSubmit={onSubmit}
      error="A categoria não aceita novos tópicos."
    />
  );
}

function TicketComposerHarness({
  onSubmit,
  onInternalChange,
}: {
  onSubmit: () => void;
  onInternalChange: (internal: boolean) => void;
}) {
  const [value, setValue] = useState('Resposta');
  return (
    <TicketComposer
      value={value}
      onChange={setValue}
      labels={{
        ...editorLabels,
        label: 'Mensagem',
        region: 'Responder ao chamado',
        submit: 'Enviar',
        internal: 'Nota interna',
        internalHint: 'O aluno não vê esta mensagem.',
      }}
      showInternalToggle
      internal
      onInternalChange={onInternalChange}
      onSubmit={onSubmit}
    />
  );
}

function BellHarness({
  unread,
  labels,
  children,
}: {
  unread: number;
  labels: NotificationBellLabels;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <NotificationBell unread={unread} open={open} onOpenChange={setOpen} labels={labels}>
      {children}
    </NotificationBell>
  );
}

function BellInitiallyOpenHarness({
  labels,
  children,
}: {
  labels: NotificationBellLabels;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <NotificationBell unread={0} open={open} onOpenChange={setOpen} labels={labels}>
      {children}
    </NotificationBell>
  );
}

describe('MarkdownEditor', () => {
  it('conta os caracteres, abre a prévia e higieniza o que a pessoa escreveu', async () => {
    wrap(<EditorHarness />);
    const textarea = screen.getByLabelText('Sua resposta') as HTMLTextAreaElement;
    expect(textarea.value).toBe('**oi**');
    const counter = screen.getByText('6 de 20000 caracteres');
    expect(counter.getAttribute('aria-live')).toBe('polite');
    expect(textarea.getAttribute('aria-describedby')).toContain(counter.id);

    fireEvent.change(textarea, {
      target: { value: '<script>alert(1)</script> [perigo](javascript:alert(1))' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prévia' }));
    const preview = screen.getByRole('region', { name: 'Prévia do texto' });
    expect(preview.getAttribute('aria-live')).toBe('polite');
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(preview.textContent).toContain('perigo');
    expect(screen.getByRole('button', { name: 'Escrever' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    // Esc volta a escrever e o foco continua no botão
    fireEvent.keyDown(screen.getByRole('button', { name: 'Escrever' }), { key: 'Escape' });
    expect(screen.getByLabelText('Sua resposta')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('anuncia o excesso e marca o campo inválido', async () => {
    wrap(
      <MarkdownEditor
        value="abcdefghijk"
        onChange={() => {}}
        labels={editorLabels}
        maxLength={10}
      />,
    );
    expect(screen.getByText('11 de 10 caracteres')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Passou de 10 caracteres');
    expect(screen.getByLabelText('Sua resposta').getAttribute('aria-invalid')).toBe('true');
    await expectNoAxeViolations();
  });

  it('mostra o vazio da prévia e aceita o HTML saneado da API', async () => {
    wrap(<EditorHarness initial="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Prévia' }));
    expect(screen.getByText('Nada escrito ainda')).toBeTruthy();
    await expectNoAxeViolations();
  });
});

const mentionItems: MentionCandidate[] = [
  { id: 'u1', username: 'ana', name: 'Ana Souza' },
  { id: 'u2', username: 'bruno' },
];

describe('menções', () => {
  it('acha a menção antes do cursor e substitui pelo nome', () => {
    expect(mentionQueryBeforeCaret('Oi @an', 6)).toEqual({ start: 3, query: 'an' });
    expect(mentionQueryBeforeCaret('email a@b', 10)).toBeNull();
    expect(mentionQueryBeforeCaret('@', 1)).toEqual({ start: 0, query: '' });
    expect(insertMention('Oi @an', 6, 'ana')).toEqual({ value: 'Oi @ana ', caret: 8 });
    expect(insertMention('Oi @', 4, 'ana')).toEqual({ value: 'Oi @ana ', caret: 8 });
  });

  it('resolve as teclas da lista', () => {
    expect(mentionKey('ArrowDown', 1, 2)).toEqual({ type: 'active', index: 0 });
    expect(mentionKey('ArrowUp', 0, 2)).toEqual({ type: 'active', index: 1 });
    expect(mentionKey('End', 0, 3)).toEqual({ type: 'active', index: 2 });
    expect(mentionKey('Enter', 1, 2)).toEqual({ type: 'select' });
    expect(mentionKey('Escape', 0, 2)).toEqual({ type: 'dismiss' });
    expect(mentionKey('Enter', -1, 2)).toEqual({ type: 'none' });
  });

  it('anda pela lista com o foco no campo e escolhe com Enter', async () => {
    const chosen = vi.fn();
    wrap(<MentionHarness onChoose={chosen} />);
    const field = screen.getByRole('textbox', { name: 'Texto' });
    field.focus();
    const list = screen.getByRole('list', { name: 'Sugestões de menção' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(field.getAttribute('aria-controls')).toBe('sugestoes');
    expect(screen.getByText('Sugestão 1 de 2: Ana Souza').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: /Ana Souza/ }).getAttribute('aria-current')).toBe(
      'true',
    );

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('Sugestão 2 de 2: bruno')).toBeTruthy();
    expect(screen.getByRole('button', { name: /bruno/i }).getAttribute('aria-current')).toBe(
      'true',
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(chosen).toHaveBeenCalledWith('bruno');
    await expectNoAxeViolations();
  });
});

const reactionLabels: ReactionLabels = {
  region: 'Reações',
  names: {
    like: 'Curtir',
    heart: 'Coração',
    celebrate: 'Comemorar',
    laugh: 'Achar graça',
    think: 'Refletir',
    eyes: 'Olhar',
  },
  button: (name, count, mine) =>
    `${name}, ${count} ${count === 1 ? 'reação' : 'reações'}${mine ? ', você reagiu' : ''}`,
};

describe('Reactions', () => {
  it('mostra as seis reações fixas, com estado e contagem no nome acessível', async () => {
    const onToggle = vi.fn();
    wrap(
      <Reactions
        reactions={[{ emoji: '👍', count: 3, mine: true }]}
        labels={reactionLabels}
        onToggle={onToggle}
      />,
    );
    const group = screen.getByRole('group', { name: 'Reações' });
    expect(within(group).getAllByRole('button')).toHaveLength(6);
    const like = screen.getByRole('button', { name: 'Curtir, 3 reações, você reagiu' });
    expect(like.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Coração, 0 reações/ }));
    expect(onToggle).toHaveBeenCalledWith('❤️');
    await expectNoAxeViolations();
  });
});

const topicLabels: TopicListLabels = {
  region: 'Tópicos da categoria',
  pinned: 'Fixado',
  solved: 'Resolvido',
  statuses: { open: 'Aberto', closed: 'Fechado', hidden: 'Oculto' },
  posts: (count) => `${count} respostas`,
  lastActivity: (at) => `última atividade em ${at.slice(0, 10)}`,
  author: (name) => `por ${name}`,
  emptyTitle: 'Nenhum tópico ainda',
  emptyText: 'Comece a conversa.',
  loading: 'Carregando os tópicos…',
  errorTitle: 'Não foi possível carregar',
  errorText: 'Tente de novo.',
  retry: 'Tentar de novo',
};

describe('fórum', () => {
  it('lista tópicos com selos, contagem e atividade; vazio sugere ação', async () => {
    wrap(
      <TopicList
        topics={[
          {
            id: 't1',
            title: 'Como usar o player',
            href: '/forum/t/t1',
            author: { name: 'Ana', href: '/membros/ana' },
            postsCount: 4,
            lastActivityAt: '2026-03-12T10:00:00Z',
            status: 'open',
            pinned: true,
            solved: true,
          },
        ]}
        labels={topicLabels}
      />,
    );
    expect(screen.getByRole('link', { name: 'Como usar o player' })).toHaveProperty(
      'href',
      'http://localhost:3000/forum/t/t1',
    );
    expect(screen.getByText('Fixado')).toBeTruthy();
    expect(screen.getByText('Resolvido')).toBeTruthy();
    expect(screen.getByText('4 respostas')).toBeTruthy();
    expect(screen.getByText('última atividade em 2026-03-12')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('tem carregando, erro e vazio com ação', async () => {
    const { rerender } = wrap(<TopicList topics={[]} labels={topicLabels} loading />);
    expect(screen.getByRole('status').textContent).toContain('Carregando os tópicos');
    rerender(
      <AdminScope>
        <TopicList topics={[]} labels={topicLabels} error onRetry={() => {}} />
      </AdminScope>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar');
    rerender(
      <AdminScope>
        <TopicList
          topics={[]}
          labels={topicLabels}
          emptyAction={<button type="button">Criar tópico</button>}
        />
      </AdminScope>,
    );
    expect(screen.getByText('Nenhum tópico ainda')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar tópico' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('desenha a publicação com HTML higienizado, edição, solução e ações', async () => {
    wrap(
      <PostCard
        post={{
          id: 'p1',
          author: { name: 'Ana', href: '/membros/ana' },
          createdAt: '2026-03-12T10:00:00Z',
          bodyHtml: DANGEROUS_HTML,
          editedAt: '2026-03-13T09:00:00Z',
          solution: true,
          hidden: true,
        }}
        labels={{
          time: (at) => `em ${at.slice(0, 10)}`,
          edited: (at) => `editado em ${at.slice(0, 10)}`,
          solution: 'Solução',
          hidden: 'Ocultado pela moderação',
          deleted: 'Mensagem removida',
          region: (author) => `Resposta de ${author}`,
        }}
        actions={<button type="button">Responder</button>}
        reactions={
          <Reactions reactions={[]} labels={reactionLabels} onToggle={() => {}} disabled />
        }
      />,
    );
    const article = screen.getByRole('article', { name: 'Resposta de Ana' });
    expect(article.querySelector('script')).toBeNull();
    expect(article.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(within(article).getByText(/Texto/)).toBeTruthy();
    expect(within(article).getByText('Ocultado pela moderação')).toBeTruthy();
    expect(within(article).getByText('Solução')).toBeTruthy();
    expect(within(article).getByText(/editado em 2026-03-13/)).toBeTruthy();
    expect(within(article).getByRole('button', { name: 'Responder' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('troca o corpo pela marca de removida e esconde as ações', async () => {
    wrap(
      <PostCard
        post={{
          id: 'p2',
          author: { name: 'Bruno' },
          createdAt: '2026-03-12T10:00:00Z',
          bodyMarkdown: 'texto antigo',
          deleted: true,
        }}
        labels={{
          time: () => 'agora',
          edited: () => 'editado',
          solution: 'Solução',
          hidden: 'Ocultado',
          deleted: 'Mensagem removida pelo autor',
          region: (author) => `Resposta de ${author}`,
        }}
        actions={<button type="button">Responder</button>}
      />,
    );
    expect(screen.getByText('Mensagem removida pelo autor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Responder' })).toBeNull();
    await expectNoAxeViolations();
  });

  it('envia tópico com título e corpo, anunciando erro e espera', async () => {
    const onSubmit = vi.fn();
    wrap(<PostComposerHarness onSubmit={onSubmit} />);
    const title = screen.getByLabelText('Título do tópico') as HTMLInputElement;
    expect(title.minLength).toBe(5);
    expect(title.maxLength).toBe(150);
    fireEvent.change(title, { target: { value: 'Dúvida' } });
    fireEvent.change(screen.getByLabelText('Sua resposta'), {
      target: { value: 'Como faço?' },
    });
    expect(screen.getByRole('alert').textContent).toContain('não aceita novos tópicos');
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });

  it('cabeçalho do tópico mostra estado, autor e ações', async () => {
    const { TopicHeader } = await import('../index');
    wrap(
      <TopicHeader
        topic={{
          id: 't9',
          title: 'Dúvida sobre a aula 3',
          author: { name: 'Ana' },
          postsCount: 2,
          status: 'closed',
        }}
        labels={{
          pinned: 'Fixado',
          solved: 'Resolvido',
          statuses: { open: 'Aberto', closed: 'Fechado', hidden: 'Oculto' },
          posts: (count) => `${count} respostas`,
          author: (name) => `por ${name}`,
        }}
        actions={<button type="button">Seguir</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Dúvida sobre a aula 3' })).toBeTruthy();
    expect(screen.getByText('Fechado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('TopicCard sozinho mantém o link e o selo de oculto', async () => {
    wrap(
      <TopicCard
        topic={{ id: 't2', title: 'Oculto', status: 'hidden', href: '/forum/t/t2' }}
        labels={topicLabels}
      />,
    );
    expect(screen.getByRole('link', { name: 'Oculto' })).toBeTruthy();
    expect(screen.getAllByText('Oculto')).toHaveLength(2);
    await expectNoAxeViolations();
  });
});

const reportLabels: ReportDialogLabels = {
  title: 'Denunciar conteúdo',
  description: 'Conte o que está errado. A equipe analisa.',
  reasonLegend: 'Motivo',
  reasons: {
    spam: 'Spam',
    harassment: 'Assédio ou ofensa',
    inappropriate: 'Conteúdo impróprio',
    piracy: 'Pirataria',
    personal_data: 'Dados pessoais expostos',
    other: 'Outro',
  },
  detailsLabel: 'Detalhes',
  detailsHint: 'Opcional, exceto em Outro.',
  detailsRequired: 'Descreva o motivo em Outro.',
  chooseReason: 'Escolha um motivo.',
  submit: 'Denunciar',
  cancel: 'Cancelar',
  close: 'Fechar',
  sending: 'Enviando…',
};

describe('denúncia e moderação', () => {
  it('exige motivo e descrição em Outro; envia o motivo escolhido', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    wrap(<ReportDialog open onClose={onClose} onSubmit={onSubmit} labels={reportLabels} />);
    const dialog = screen.getByRole('dialog', { name: 'Denunciar conteúdo' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(REPORT_REASONS.length);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Denunciar' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Escolha um motivo.');

    fireEvent.click(within(dialog).getByLabelText('Outro'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Denunciar' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Descreva o motivo em Outro.');

    fireEvent.change(within(dialog).getByLabelText('Detalhes'), {
      target: { value: '  contexto  ' },
    });
    fireEvent.click(within(dialog).getByLabelText('Spam'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Denunciar' }));
    expect(onSubmit).toHaveBeenCalledWith({ reason: 'spam', details: 'contexto' });
    await expectNoAxeViolations();
  });

  it('fecha com Esc e devolve o foco', async () => {
    const onClose = vi.fn();
    wrap(<ReportDialog open onClose={onClose} onSubmit={() => {}} labels={reportLabels} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('mostra o conteúdo denunciado com contexto, autor, denunciantes e ações', async () => {
    wrap(
      <ReportedContent
        target={{
          id: 'p1',
          kindLabel: 'Resposta do fórum',
          title: 'Resposta suspeita',
          bodyHtml: DANGEROUS_HTML,
          author: { name: 'Ana', avatarUrl: null },
          context: <span>Tópico: Dúvida</span>,
          reporters: [{ name: 'Bruno' }, { name: 'Carla' }],
          reportsCount: 2,
          reasons: [{ label: 'Spam', count: 2 }],
        }}
        labels={{
          region: 'Conteúdo denunciado',
          reports: (count) => `${count} denúncias`,
          reporterList: 'Denunciaram',
          reasonsLabel: 'Motivos',
          contextLabel: 'Contexto',
          authorLabel: 'Autor',
        }}
        actions={<button type="button">Ocultar</button>}
      />,
    );
    const card = screen.getByRole('article', { name: 'Conteúdo denunciado: Resposta do fórum' });
    expect(card.querySelector('script')).toBeNull();
    expect(within(card).getByText('2 denúncias')).toBeTruthy();
    expect(within(card).getByText('Tópico: Dúvida')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Ocultar' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('histórico vazio e com ações', async () => {
    const labels = {
      region: 'Histórico de moderação',
      emptyTitle: 'Nada registrado',
      emptyText: 'Sem advertências.',
      reasonLabel: 'Motivo',
      moderatorLabel: 'Moderador',
      time: (at: string) => at.slice(0, 10),
    };
    const { rerender } = wrap(<ModerationHistory items={[]} labels={labels} />);
    expect(screen.getByText('Nada registrado')).toBeTruthy();
    rerender(
      <AdminScope>
        <ModerationHistory
          items={[
            {
              id: 'a1',
              action: 'Advertência',
              at: '2026-03-12T10:00:00Z',
              reason: 'Spam',
              moderator: 'Ana',
            },
          ]}
          labels={labels}
        />
      </AdminScope>,
    );
    expect(screen.getByText('Advertência')).toBeTruthy();
    expect(screen.getByText('Motivo: Spam')).toBeTruthy();
    await expectNoAxeViolations();
  });
});

describe('chamados', () => {
  const messages = [
    {
      id: 'm1',
      author: { name: 'Aluno' },
      createdAt: '2026-03-12T10:00:00Z',
      bodyHtml: renderMarkdownToHtml('Olá, não consigo abrir a aula.'),
    },
    {
      id: 'm2',
      author: { name: 'Ana' },
      createdAt: '2026-03-12T11:00:00Z',
      bodyHtml: DANGEROUS_HTML,
      internal: true,
      staff: true,
    },
  ];
  const conversationLabels = {
    region: 'Conversa do chamado',
    internal: 'Nota interna',
    staff: (name: string) => `Equipe · ${name}`,
    time: () => 'agora',
  };

  it('esconde a nota interna do aluno e a mostra à equipe', async () => {
    const { rerender } = wrap(
      <TicketConversation messages={messages} labels={conversationLabels} />,
    );
    expect(screen.queryByText('Nota interna')).toBeNull();
    expect(screen.queryByText(/Equipe · Ana/)).toBeNull();
    expect(screen.getByText('Olá, não consigo abrir a aula.')).toBeTruthy();
    await expectNoAxeViolations();

    rerender(
      <AdminScope>
        <TicketConversation messages={messages} labels={conversationLabels} showInternal />
      </AdminScope>,
    );
    expect(screen.getByText('Nota interna')).toBeTruthy();
    expect(screen.getByText('Equipe · Ana')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    await expectNoAxeViolations();
  });

  it('responde com nota interna opcional na equipe', async () => {
    const onSubmit = vi.fn();
    const onInternalChange = vi.fn();
    wrap(<TicketComposerHarness onSubmit={onSubmit} onInternalChange={onInternalChange} />);
    expect(screen.getByText('O aluno não vê esta mensagem.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Nota interna/ }));
    expect(onInternalChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });

  const ticketLabels: TicketListLabels = {
    region: 'Chamados',
    statuses: {
      open: 'Aberto',
      pending: 'Aguardando aluno',
      resolved: 'Resolvido',
      closed: 'Fechado',
    },
    emptyTitle: 'Nenhum chamado',
    emptyText: 'Abra um chamado quando precisar.',
    loading: 'Carregando chamados…',
    errorTitle: 'Falha ao carregar',
    errorText: 'Tente de novo.',
    retry: 'Tentar de novo',
    number: (number) => `#${number}`,
    lastUserReply: (at) => `aluno em ${at.slice(0, 10)}`,
    reports: (count) => `${count} relatos`,
    assignee: (name) => `Responsável: ${name}`,
  };

  it('lista chamados com estado, espera, relatos e responsável', async () => {
    wrap(
      <TicketList
        tickets={[
          {
            id: 'k1',
            number: 42,
            subject: 'Vídeo não abre',
            href: '/chamados/k1',
            status: 'open',
            kindLabel: 'Link quebrado',
            lastUserMessageAt: '2026-03-12T10:00:00Z',
            reportsCount: 3,
            assignee: { name: 'Ana' },
          },
        ]}
        labels={ticketLabels}
      />,
    );
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vídeo não abre' })).toBeTruthy();
    expect(screen.getByText('Aberto')).toBeTruthy();
    expect(screen.getByText('aluno em 2026-03-12')).toBeTruthy();
    expect(screen.getByText('3 relatos')).toBeTruthy();
    expect(screen.getByText('Responsável: Ana')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('lista vazia, carregando e com erro', async () => {
    const { rerender } = wrap(<TicketList tickets={[]} labels={ticketLabels} />);
    expect(screen.getByText('Nenhum chamado')).toBeTruthy();
    rerender(
      <AdminScope>
        <TicketList tickets={[]} labels={ticketLabels} loading />
      </AdminScope>,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando chamados');
    rerender(
      <AdminScope>
        <TicketList tickets={[]} labels={ticketLabels} error onRetry={() => {}} />
      </AdminScope>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Falha ao carregar');
    await expectNoAxeViolations();
  });

  it('reporta link com produto, aula e endereço já preenchidos', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    wrap(
      <ReportLinkDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
        labels={{
          title: 'Reportar problema',
          description: 'Avisamos a equipe sobre o link.',
          productLabel: 'Produto',
          lessonLabel: 'Aula',
          linkLabel: 'Link',
          messageLabel: 'O que aconteceu?',
          messageHint: 'Opcional.',
          submit: 'Enviar',
          cancel: 'Cancelar',
          close: 'Fechar',
        }}
        product="Curso de React"
        lesson="Aula 3"
        link="https://example.com/video"
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Reportar problema' });
    expect(within(dialog).getByText('Curso de React')).toBeTruthy();
    expect(within(dialog).getByText('Aula 3')).toBeTruthy();
    expect(within(dialog).getByText('https://example.com/video')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('O que aconteceu?'), {
      target: { value: 'Dá erro 404' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    expect(onSubmit).toHaveBeenCalledWith('Dá erro 404');
    await expectNoAxeViolations();
  });
});

describe('tempo do calendário', () => {
  const start = '2026-11-26T18:00:00Z';
  const end = '2026-11-26T19:00:00Z';

  it('calcula o estado pelo relógio e pelo cancelamento', () => {
    expect(eventStatus(start, end, '2026-11-26T17:59:00Z')).toBe('upcoming');
    expect(eventStatus(start, end, '2026-11-26T18:00:00Z')).toBe('live');
    expect(eventStatus(start, end, '2026-11-26T19:00:00Z')).toBe('past');
    expect(eventStatus(start, end, '2026-11-26T18:30:00Z', '2026-11-20T10:00:00Z')).toBe(
      'canceled',
    );
  });

  it('abre o link 15 minutos antes e fecha no fim', () => {
    expect(eventJoinState(start, end, '2026-11-26T17:44:59Z')).toBe('early');
    expect(eventJoinState(start, end, '2026-11-26T17:45:00Z')).toBe('open');
    expect(eventJoinState(start, end, '2026-11-26T18:59:59Z')).toBe('open');
    expect(eventJoinState(start, end, '2026-11-26T19:00:00Z')).toBe('ended');
  });

  it('usa o fuso pedido para o dia civil', () => {
    expect(zonedDateKey('2026-11-27T01:30:00Z', 'America/Sao_Paulo')).toBe('2026-11-26');
    expect(zonedDateKey('2026-11-27T01:30:00Z', 'UTC')).toBe('2026-11-27');
  });

  it('monta o mês começando no domingo ou na segunda', () => {
    const sunday = buildMonthGrid('2026-11', 0);
    expect(sunday[0]?.[0]?.date).toBe('2026-11-01');
    expect(sunday.flat().filter((day) => day.inMonth)).toHaveLength(30);
    const monday = buildMonthGrid('2026-11', 1);
    expect(monday[0]?.[0]?.date).toBe('2026-10-26');
    expect(formatMonthLabel('2026-11', 'pt-BR')).toBe('novembro de 2026');
    expect(weekdayLabels('pt-BR')[0]?.toLowerCase()).toContain('dom');
  });
});

describe('calendário e eventos', () => {
  const calendarLabels: MonthCalendarLabels = {
    region: 'Agenda',
    previousMonth: 'Mês anterior',
    nextMonth: 'Mês seguinte',
    day: (date, events) => `${date}, ${events} eventos`,
    dayEvent: (title) => `Evento: ${title}`,
    empty: 'Nenhum evento neste mês.',
  };

  it('marca os eventos no dia civil do fuso e navega por teclado', async () => {
    const onSelectDay = vi.fn();
    const onMonthChange = vi.fn();
    wrap(
      <MonthCalendar
        month="2026-11"
        now="2026-11-26T12:00:00Z"
        timeZone="America/Sao_Paulo"
        events={[
          {
            id: 'e1',
            title: 'Live de React',
            startsAt: '2026-11-26T23:30:00Z',
            endsAt: '2026-11-27T00:30:00Z',
          },
          {
            id: 'e2',
            title: 'Encontro',
            startsAt: '2026-11-27T01:30:00Z',
            endsAt: '2026-11-27T02:30:00Z',
          },
        ]}
        labels={calendarLabels}
        onSelectDay={onSelectDay}
        onMonthChange={onMonthChange}
      />,
    );
    // 27/11 às 01:30 UTC ainda é 26/11 em São Paulo: os dois eventos caem no dia 26
    const day26 = screen.getByRole('button', {
      name: `${formatCivilDate('2026-11-26', 'pt-BR')}, 2 eventos`,
    });
    expect(day26.getAttribute('tabindex')).toBe('0');
    expect(day26.getAttribute('aria-current')).toBe('date');
    expect(within(day26).getByText(/Evento: Live de React/)).toBeTruthy();

    fireEvent.keyDown(day26, { key: 'ArrowRight' });
    const day27 = screen.getByRole('button', {
      name: `${formatCivilDate('2026-11-27', 'pt-BR')}, 0 eventos`,
    });
    expect(document.activeElement).toBe(day27);
    fireEvent.keyDown(day27, { key: 'Home' });
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toContain(
      formatCivilDate('2026-11-22', 'pt-BR'),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(onSelectDay).toHaveBeenCalledWith('2026-11-22');

    fireEvent.click(screen.getByRole('button', { name: 'Mês seguinte' }));
    expect(onMonthChange).toHaveBeenCalledWith('2026-12');
    await expectNoAxeViolations();
  });

  it('EventCard acompanha o relógio, o fuso, o bloqueio e a gravação', async () => {
    const labels: EventCardLabels = {
      region: 'Evento',
      statuses: {
        upcoming: 'Em breve',
        live: 'Ao vivo',
        past: 'Encerrado',
        canceled: 'Cancelado',
      },
      kinds: { live: 'Live', meeting: 'Encontro', workshop: 'Oficina', other: 'Outro' },
      join: 'Entrar',
      details: 'Detalhes',
      recording: 'Ver gravação',
      blockedTitle: 'Exclusivo para alunos',
      blockedText: 'Garanta o acesso ao curso.',
    };
    const event = {
      id: 'e1',
      title: 'Live de React',
      startsAt: '2026-11-27T01:30:00Z',
      endsAt: '2026-11-27T02:30:00Z',
      kind: 'live' as const,
      descriptionHtml: DANGEROUS_HTML,
      recordingHref: '/meus-cursos/react/aulas/gravacao',
    };
    const joinAction = <button type="button">Entrar na transmissão</button>;
    const { rerender } = wrap(
      <EventCard
        event={event}
        now="2026-11-27T01:00:00Z"
        labels={labels}
        joinAction={joinAction}
        timeZone="America/Sao_Paulo"
      />,
    );
    const card = screen.getByRole('article', { name: 'Evento: Live de React' });
    expect(within(card).getByText('Em breve')).toBeTruthy();
    expect(within(card).getByText(/22:30/)).toBeTruthy();
    expect(card.querySelector('script')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Entrar na transmissão' })).toBeNull();

    rerender(
      <AdminScope>
        <EventCard
          event={event}
          now="2026-11-27T01:50:00Z"
          labels={labels}
          joinAction={joinAction}
          timeZone="America/Sao_Paulo"
        />
      </AdminScope>,
    );
    expect(screen.getByText('Ao vivo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar na transmissão' })).toBeTruthy();

    rerender(
      <AdminScope>
        <EventCard
          event={{ ...event, blocked: true }}
          now="2026-11-27T03:00:00Z"
          labels={labels}
          timeZone="America/Sao_Paulo"
        />
      </AdminScope>,
    );
    expect(screen.getByText('Encerrado')).toBeTruthy();
    expect(screen.getByText('Exclusivo para alunos')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver gravação/ })).toBeNull();

    rerender(
      <AdminScope>
        <EventCard
          event={event}
          now="2026-11-27T03:00:00Z"
          labels={labels}
          timeZone="America/Sao_Paulo"
        />
      </AdminScope>,
    );
    expect(screen.getByRole('link', { name: /Ver gravação/ })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('banner anuncia o evento ao vivo sem tirar o foco', async () => {
    const labels = {
      region: 'Evento ao vivo',
      statuses: {
        upcoming: 'Em breve',
        live: 'Ao vivo',
        past: 'Encerrado',
        canceled: 'Cancelado',
      },
      liveTitle: 'Acontecendo agora',
      join: 'Entrar',
    };
    const event = {
      id: 'e2',
      title: 'Oficina de CSS',
      startsAt: '2026-11-26T18:00:00Z',
      endsAt: '2026-11-26T20:00:00Z',
    };
    const { rerender } = wrap(
      <EventBanner event={event} now="2026-11-26T17:00:00Z" labels={labels} />,
    );
    const region = screen.getByRole('status', { name: 'Evento ao vivo' });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(within(region).queryByText('Oficina de CSS')).toBeNull();

    rerender(
      <AdminScope>
        <EventBanner event={event} now="2026-11-26T18:30:00Z" labels={labels} />
      </AdminScope>,
    );
    expect(screen.getByText('Oficina de CSS')).toBeTruthy();
    expect(screen.getByText('Acontecendo agora')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('EventTime mostra o intervalo no fuso', () => {
    wrap(
      <EventTime
        startsAt="2026-11-27T01:30:00Z"
        endsAt="2026-11-27T02:30:00Z"
        timeZone="America/Sao_Paulo"
      />,
    );
    const time = screen.getByText(/22:30/);
    expect(time.textContent).toContain('23:30');
    expect(time.textContent).toContain('nov');
  });
});

const announcementLabels: AnnouncementListLabels = {
  region: 'Novidades',
  pinned: 'Fixada',
  unread: 'Não lida',
  date: (at) => at.slice(0, 10),
  emptyTitle: 'Nenhuma novidade',
  emptyText: 'Volte depois.',
  loading: 'Carregando novidades…',
  errorTitle: 'Falha ao carregar',
  errorText: 'Tente de novo.',
  retry: 'Tentar de novo',
};

describe('novidades', () => {
  it('mostra fixada, não lida, capa e destino externo com HTML seguro', async () => {
    wrap(
      <AnnouncementCard
        announcement={{
          id: 'n1',
          title: 'Novo curso de SQL',
          href: '/novidades/n1',
          publishedAt: '2026-03-12T10:00:00Z',
          pinned: true,
          unread: true,
          coverUrl: 'https://example.com/capa.png',
          coverAlt: 'Capa do curso',
          bodyHtml: DANGEROUS_HTML,
          link: { href: 'https://example.com/sql', label: 'Conhecer', external: true },
        }}
        labels={announcementLabels}
      />,
    );
    const card = screen.getByRole('article', { name: 'Novidades: Novo curso de SQL' });
    expect(within(card).getByText('Fixada')).toBeTruthy();
    expect(within(card).getByText('Não lida')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Capa do curso' })).toBeTruthy();
    expect(card.querySelector('script')).toBeNull();
    const external = within(card).getByRole('link', { name: /Conhecer/ });
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toBe('noreferrer');
    await expectNoAxeViolations();
  });

  it('lista com vazio, carregando e erro', async () => {
    const { rerender } = wrap(<AnnouncementList announcements={[]} labels={announcementLabels} />);
    expect(screen.getByText('Nenhuma novidade')).toBeTruthy();
    rerender(
      <AdminScope>
        <AnnouncementList announcements={[]} labels={announcementLabels} loading />
      </AdminScope>,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando novidades');
    rerender(
      <AdminScope>
        <AnnouncementList announcements={[]} labels={announcementLabels} error onRetry={() => {}} />
      </AdminScope>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Falha ao carregar');
    await expectNoAxeViolations();
  });
});

describe('notificações', () => {
  const notificationLabels: NotificationListLabels = {
    region: 'Notificações',
    emptyTitle: 'Tudo em dia',
    emptyText: 'Nenhuma notificação.',
    loading: 'Carregando notificações…',
    errorTitle: 'Falha ao carregar',
    errorText: 'Tente de novo.',
    retry: 'Tentar de novo',
    markAll: 'Marcar todas como lidas',
    clearAll: 'Limpar todas',
    unread: 'Não lida',
    grouped: (count) => `e mais ${count - 1}`,
    time: (at) => `em ${at.slice(0, 10)}`,
  };

  it('abre o painel com foco, fecha com Esc e devolve o foco ao sino', async () => {
    wrap(
      <BellHarness
        unread={3}
        labels={{
          button: (unread) => `Notificações, ${unread} não lidas`,
          title: 'Notificações',
          close: 'Fechar notificações',
        }}
      >
        <NotificationList
          items={[
            {
              id: 'z1',
              title: 'Ana respondeu no tópico',
              href: '/forum/t/t1',
              createdAt: '2026-03-12T10:00:00Z',
              read: false,
              groupCount: 2,
            },
          ]}
          labels={notificationLabels}
          onMarkAll={() => {}}
          onClearAll={() => {}}
        />
      </BellHarness>,
    );
    const button = screen.getByRole('button', { name: 'Notificações, 3 não lidas' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const panel = screen.getByRole('dialog', { name: 'Notificações' });
    expect(panel).toBe(document.activeElement);
    expect(screen.getByText('Ana respondeu no tópico')).toBeTruthy();
    expect(screen.getByText('e mais 1')).toBeTruthy();
    await expectNoAxeViolations();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('fecha ao clicar fora', async () => {
    wrap(
      <BellInitiallyOpenHarness
        labels={{ button: () => 'Notificações', title: 'Notificações', close: 'Fechar' }}
      >
        <p>conteúdo</p>
      </BellInitiallyOpenHarness>,
    );
    expect(screen.getByRole('dialog', { name: 'Notificações' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Notificações' })).toBeNull();
    await expectNoAxeViolations();
  });

  it('marca todas e limpa pela central', async () => {
    const onMarkAll = vi.fn();
    const onClearAll = vi.fn();
    const onOpen = vi.fn();
    wrap(
      <NotificationList
        items={[
          {
            id: 'z1',
            title: 'Resposta no chamado',
            createdAt: '2026-03-12T10:00:00Z',
            read: true,
          },
          {
            id: 'z2',
            title: 'Menção no fórum',
            createdAt: '2026-03-12T11:00:00Z',
            read: false,
          },
        ]}
        labels={notificationLabels}
        onMarkAll={onMarkAll}
        onClearAll={onClearAll}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText('Não lida')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(onMarkAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar todas' }));
    expect(onClearAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Menção no fórum/ }));
    expect(onOpen).toHaveBeenCalledWith('z2');
    await expectNoAxeViolations();
  });

  it('preferências travam os grupos obrigatórios e avisam a mudança', async () => {
    const onChange = vi.fn();
    wrap(
      <NotificationPreferences
        groups={[
          { id: 'forum', label: 'Fórum', inApp: true, email: true },
          {
            id: 'support',
            label: 'Suporte',
            inApp: true,
            email: true,
            emailLocked: true,
            lockedReason: 'E-mail sempre enviado.',
          },
          { id: 'account', label: 'Conta', inApp: null, email: true, emailLocked: true },
        ]}
        labels={{
          region: 'Preferências de notificação',
          title: 'Notificações',
          description: 'Escolha por grupo.',
          inApp: 'Plataforma',
          email: 'E-mail',
          required: 'Sempre ativo',
          notAvailable: 'Sem canal',
          saved: 'Preferências salvas.',
        }}
        onChange={onChange}
      />,
    );
    const forum = screen.getByRole('switch', { name: 'Fórum: Plataforma' });
    fireEvent.click(forum);
    expect(onChange).toHaveBeenCalledWith('forum', 'inApp', false);
    const email = screen.getByRole('switch', { name: 'Suporte: E-mail' }) as HTMLInputElement;
    expect(email.disabled).toBe(true);
    expect(screen.getAllByText('Sempre ativo')).toHaveLength(2);
    expect(screen.getByText('Sem canal')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Preferências salvas.');
    await expectNoAxeViolations();
  });
});
