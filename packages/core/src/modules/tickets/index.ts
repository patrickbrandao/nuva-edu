// Chamados de suporte (spec 023): regras comuns, o que o aluno faz pelo classroom, o
// atendimento pela equipe e o fechamento automático do worker.

export {
  type AdminTicket,
  type AdminTicketDetail,
  listTickets,
  readTicket,
  replyToTicket,
  type TicketPatch,
  type TicketsQuery,
  type TicketUserContext,
  updateTicket,
} from './admin.ts';
export {
  autocloseResolvedTickets,
  TICKET_AUTOCLOSE_BATCH_SIZE,
  type TicketAutocloseOptions,
  type TicketAutocloseResult,
} from './autoclose.ts';
export {
  type BrokenLinkReport,
  type BrokenLinkTarget,
  listMyTickets,
  type MyTicket,
  type MyTicketDetail,
  type MyTicketsQuery,
  type OpenTicketInput,
  openTicket,
  readMyTicket,
  replyToMyTicket,
  reportBrokenLink,
  resolveMyTicket,
  type TicketRelation,
} from './classroom.ts';
export {
  isTicketStatus,
  TICKET_AUTOCLOSE_DEFAULT_DAYS,
  TICKET_AUTOCLOSE_SETTING_KEY,
  TICKET_MESSAGE_MAX_LENGTH,
  TICKET_MESSAGES_PER_HOUR,
  TICKET_STATUSES,
  TICKET_SUBJECT_MAX_LENGTH,
  TICKET_SUBJECT_MIN_LENGTH,
  TICKET_TARGET_TYPE,
  TICKET_TRANSITIONS,
  TICKETS_PER_DAY,
  type Ticket,
  type TicketMessage,
  type TicketStatus,
  ticketAutocloseDays,
  ticketClosed,
} from './rules.ts';
