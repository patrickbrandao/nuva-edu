// Calendário e eventos (spec 018): gestão pela equipe, leituras do aluno, link de transmissão
// e lembrete.

export {
  type AdminEvent,
  type AdminEventsPage,
  type AdminEventsQuery,
  type CreateEventInput,
  cancelEvent,
  createEvent,
  deleteEvent,
  type EventInput,
  type EventPatch,
  listEvents,
  readEvent,
  updateEvent,
} from './admin.ts';
export {
  EVENT_AGENDA_MAX_DAYS,
  type EventAgenda,
  type EventJoin,
  type EventRecording,
  type EventRecordingRef,
  type EventSummary,
  type EventView,
  getEventView,
  joinEvent,
  listEventAgenda,
  listEventRecordings,
  listLiveEvents,
} from './classroom.ts';
export {
  type EventReminderResult,
  type EventReminderSkip,
  sendEventReminder,
} from './reminders.ts';
export {
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_JOIN_LEAD_MS,
  EVENT_KINDS,
  EVENT_MAX_DURATION_MS,
  EVENT_REPEAT_MAX_WEEKS,
  EVENT_STATUSES,
  EVENT_TARGET_TYPE,
  EVENT_TITLE_MAX_LENGTH,
  type EventKind,
  type EventStatus,
  eventJoinOpensAt,
  eventStatus,
} from './rules.ts';
