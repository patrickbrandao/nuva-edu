-- 0018: chamados de suporte (spec 023, "Dados" e "Comportamento").
-- Donos dos dados: tickets, a classroom-api na abertura e na resolução pelo aluno, a admin-api
-- no estado e na atribuição e o worker no fechamento automático; ticket_messages, a
-- classroom-api (aluno) e a admin-api (equipe); ticket_followers, a classroom-api.
-- Reutiliza users (0005), orders (0014), courses/modules/lessons e ebooks (0009), settings (0001,
-- prazo do fechamento automático), audit_log (0006, mudanças de estado e atribuição), notifications
-- (0016, resposta e mudança de estado) e email_outbox (0007, e-mail): esta migration não cria
-- infraestrutura de conta, catálogo, notificação, e-mail nem auditoria.
--
-- Decisões de esquema que a spec não fixa (mesmas convenções da 0009 a 0017; relatadas ao
-- arquiteto na tarefa 572):
-- - O número legível vem de ticket_number_seq, como orders.number vem de order_number_seq: só o
--   identificador exibido, com saltos aceitos (ROLLBACK não devolve número). O id UUID v7
--   continua sendo a chave e o cursor da paginação.
-- - A descrição não é coluna de tickets: é a primeira ticket_messages do autor, no mesmo formato
--   Markdown saneado das demais publicações (ADR 0027). O assunto fica em tickets.subject, com o
--   teto de 150 e não vazio no banco; o piso de 5 caracteres da RNF-02 é do código, para não
--   recusar um assunto que o próprio código já validou em outra versão.
-- - Estado e datas andam juntos, para o banco recusar os combinações que a spec não admite:
--   open e pending têm resolved_at e closed_at nulos; resolved tem resolved_at e closed_at nulo;
--   closed tem closed_at. O resolved_at sobrevive ao fechamento (o chamado foi resolvido antes
--   de fechar) e pode ser nulo no fechamento direto de open/pending; os dois, quando presentes,
--   mantêm resolved_at <= closed_at. Reabrir um resolved limpa resolved_at na mesma transação.
-- - last_user_message_at é mantido pelo código (como forum_topics.last_activity_at): nasce agora,
--   avança a cada mensagem do aluno e não muda na resposta da equipe, porque é o que a tela do
--   admin ordena e exibe (RF-07). O banco garante só o valor inicial coerente.
-- - reports_count começa em 1 e a soma dos relatos de broken_link é do código, com
--   ticket_followers guardando quem relatou. A deduplicação (mesma aula ou ebook, chamado open ou
--   pending) não vira unicidade: o novo relato entra no chamado existente em vez de criar linha,
--   então os índices parciais de lesson_id e ebook_id servem à busca, não a uma restrição.
-- - Notas internas são ticket_messages.internal, não uma tabela à parte: a classroom-api filtra
--   internal = false em toda leitura e a admin-api lê as duas. O banco não consegue saber quem lê.
-- - ticket_followers é a lista de quem passou a acompanhar por relato somado de broken_link
--   (023); o aluno que abriu continua identificado por tickets.user_id, sem linha duplicada. A
--   chave primária (ticket_id, user_id) impede repetição e a leitura filtra pelo próprio usuário.
-- - Vínculos opcionais com pedido, curso, aula e ebook: as chaves são ON DELETE SET NULL porque o
--   chamado sobrevive à exclusão do catálogo (a conversa é o registro de suporte). users e
--   assignee_id não têm cascata: a linha de users nunca é apagada (spec 030) e o chamado
--   anonimizado continua apontando para ela, exibido como "usuário removido".
-- - Sem token, sessão especial, rota pública ou token anônimo de suporte: o acesso é a sessão
--   normal e a suspensão full o bloqueia (specs 007, 023 e 026). Esta migration não cria tabela
--   de acesso de suporte.
-- - "Reportar problema" no player e na página do ebook abre um chamado broken_link (RF-04); não
--   é denúncia (reports, 026) nem tem anexos (fora de escopo na 023). Registro da abertura,
--   mudança de estado e atribuição continua em audit_log; resposta e mudança de estado notificam
--   pelos tipos da 024 (ticket.reply, ticket.status_changed, ticket.opened, ticket.user_reply),
--   sem tabela nova.
-- - Retenção (023): permanente enquanto a conta existir, sem índice de expurgo. Os chamados
--   payment/refund ligados a pedido seguem o prazo fiscal do pedido (030 e 033), tratado na
--   anonimização, não aqui.
-- - Limites (RNF-01) ficam no código: 5 chamados por dia por usuário e 30 mensagens por hora por
--   chamado. Os índices por usuário/data e por chamado/autor/data atendem a contagem.

-- migrate:up

-- Número legível do chamado; saltos são aceitos (ROLLBACK não devolve o número).
CREATE SEQUENCE ticket_number_seq AS bigint;

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  number bigint NOT NULL DEFAULT nextval('ticket_number_seq'),
  -- Aluno que abriu; a linha de users permanece anonimizada na exclusão de conta (spec 030).
  user_id uuid NOT NULL,
  -- question, access, payment, refund, broken_link, bug, suggestion ou privacy (023).
  kind text NOT NULL,
  -- Assunto exibido na lista; o piso de 5 caracteres da RNF-02 é do código.
  subject text NOT NULL,
  -- open: aguardando a equipe; pending: aguardando o aluno; resolved: resolvido; closed:
  -- encerrado, sem respostas.
  status text NOT NULL DEFAULT 'open',
  -- Membro da equipe responsável; opcional (sem responsável, a equipe toda é notificada).
  assignee_id uuid,
  -- Vínculos opcionais do chamado (RF-05); sobrevivem à exclusão do que apontam.
  order_id uuid,
  course_id uuid,
  lesson_id uuid,
  ebook_id uuid,
  -- Quantos alunos relataram o mesmo broken_link (RF-04 e deduplicação da 023).
  reports_count integer NOT NULL DEFAULT 1,
  -- Última mensagem do aluno; é o que a tela do admin ordena (RF-07).
  last_user_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_number_unique UNIQUE (number),
  CONSTRAINT tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT tickets_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES users (id),
  CONSTRAINT tickets_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT tickets_course_id_fkey FOREIGN KEY (course_id)
    REFERENCES courses (id) ON DELETE SET NULL,
  CONSTRAINT tickets_lesson_id_fkey FOREIGN KEY (lesson_id)
    REFERENCES lessons (id) ON DELETE SET NULL,
  CONSTRAINT tickets_ebook_id_fkey FOREIGN KEY (ebook_id)
    REFERENCES ebooks (id) ON DELETE SET NULL,
  CONSTRAINT tickets_number_positive CHECK (number > 0),
  CONSTRAINT tickets_kind_valid CHECK (kind IN (
    'question', 'access', 'payment', 'refund', 'broken_link', 'bug', 'suggestion', 'privacy'
  )),
  CONSTRAINT tickets_status_valid CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  CONSTRAINT tickets_subject_length CHECK (
    btrim(subject) <> '' AND char_length(subject) <= 150
  ),
  CONSTRAINT tickets_reports_count_range CHECK (reports_count >= 1),
  -- Estado e datas coerentes: ver o cabeçalho (resolved_at sobrevive ao fechamento).
  CONSTRAINT tickets_status_matches_timestamps CHECK (
    CASE status
      WHEN 'open' THEN resolved_at IS NULL AND closed_at IS NULL
      WHEN 'pending' THEN resolved_at IS NULL AND closed_at IS NULL
      WHEN 'resolved' THEN resolved_at IS NOT NULL AND closed_at IS NULL
      WHEN 'closed' THEN closed_at IS NOT NULL
        AND (resolved_at IS NULL OR resolved_at <= closed_at)
    END
  )
);

-- Tela do admin com filtro de estado (RF-07), mais antiga resposta do aluno primeiro:
-- WHERE status = $1 ORDER BY last_user_message_at, id.
CREATE INDEX tickets_status_last_user_idx
  ON tickets (status, last_user_message_at, id);

-- Filtro por tipo na mesma tela: WHERE kind = $1 [AND status = $2]
-- ORDER BY last_user_message_at, id.
CREATE INDEX tickets_kind_status_idx
  ON tickets (kind, status, last_user_message_at, id);

-- Filtro por responsável: WHERE assignee_id = $1 [AND status = $2]
-- ORDER BY last_user_message_at, id.
CREATE INDEX tickets_assignee_status_idx
  ON tickets (assignee_id, status, last_user_message_at, id)
  WHERE assignee_id IS NOT NULL;

-- Filtro por curso e escopo do instrutor (008 e 023): WHERE course_id = $1 [AND status = $2]
-- ORDER BY last_user_message_at, id.
CREATE INDEX tickets_course_status_idx
  ON tickets (course_id, status, last_user_message_at, id)
  WHERE course_id IS NOT NULL;

-- "Meus chamados" e limite de 5 por dia:
-- WHERE user_id = $1 [AND created_at > now() - interval '1 day'] ORDER BY created_at DESC, id.
CREATE INDEX tickets_user_created_idx ON tickets (user_id, created_at DESC, id DESC);

-- Fechamento automático (ticket.autoclose, RNF-03): WHERE status = 'resolved'
-- AND resolved_at <= now() - interval '7 days'.
CREATE INDEX tickets_autoclose_idx ON tickets (resolved_at) WHERE status = 'resolved';

-- Deduplicação de broken_link (RF-04): WHERE kind = 'broken_link'
-- AND status IN ('open', 'pending') AND lesson_id = $1.
CREATE INDEX tickets_broken_link_lesson_idx ON tickets (lesson_id)
  WHERE kind = 'broken_link' AND status IN ('open', 'pending');

-- Mesma deduplicação para ebook: WHERE kind = 'broken_link'
-- AND status IN ('open', 'pending') AND ebook_id = $1.
CREATE INDEX tickets_broken_link_ebook_idx ON tickets (ebook_id)
  WHERE kind = 'broken_link' AND status IN ('open', 'pending');

CREATE TRIGGER tickets_set_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ticket_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_id uuid NOT NULL,
  -- Aluno ou membro da equipe; a linha de users permanece anonimizada (spec 030).
  author_id uuid NOT NULL,
  -- Markdown saneado e HTML correspondente, gravados juntos (ADR 0027).
  body_md text NOT NULL,
  body_html text NOT NULL,
  -- Nota interna da equipe: nunca sai pela classroom-api (RF-02 e 023).
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON DELETE CASCADE,
  CONSTRAINT ticket_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES users (id),
  CONSTRAINT ticket_messages_body_md_length CHECK (
    btrim(body_md) <> '' AND char_length(body_md) <= 10000
  ),
  CONSTRAINT ticket_messages_body_html_not_empty CHECK (body_html <> '')
);

-- Leitura da conversa: WHERE ticket_id = $1 ORDER BY created_at, id.
CREATE INDEX ticket_messages_ticket_created_idx
  ON ticket_messages (ticket_id, created_at, id);

-- Limite de 30 mensagens por hora no chamado:
-- WHERE ticket_id = $1 AND author_id = $2 AND created_at > now() - interval '1 hour'.
CREATE INDEX ticket_messages_ticket_author_created_idx
  ON ticket_messages (ticket_id, author_id, created_at DESC);

-- Quem acompanha o chamado, inclusive os relatos somados de broken_link (023).
CREATE TABLE ticket_followers (
  ticket_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_followers_pkey PRIMARY KEY (ticket_id, user_id),
  CONSTRAINT ticket_followers_ticket_id_fkey FOREIGN KEY (ticket_id)
    REFERENCES tickets (id) ON DELETE CASCADE,
  CONSTRAINT ticket_followers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);

-- "Chamados que eu acompanho": WHERE user_id = $1, juntando com tickets.
CREATE INDEX ticket_followers_user_idx ON ticket_followers (user_id, ticket_id);

-- migrate:down

DROP TABLE ticket_followers;
DROP TABLE ticket_messages;
DROP TABLE tickets;
DROP SEQUENCE ticket_number_seq;
