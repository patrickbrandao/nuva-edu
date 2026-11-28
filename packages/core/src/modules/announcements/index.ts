// Novidades (spec 025): gestão pela equipe, publicação imediata e agendada, e o mural do aluno
// com o contador de não lidas.

export {
  type AdminAnnouncement,
  type AdminAnnouncementsQuery,
  type AnnouncementInput,
  type AnnouncementPatch,
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  type PublishAnnouncementInput,
  publishAnnouncement,
  readAnnouncement,
  unscheduleAnnouncement,
  updateAnnouncement,
} from './admin.ts';
export {
  type Announcement,
  countUnreadAnnouncements,
  listMyAnnouncements,
  markAnnouncementsSeen,
  readMyAnnouncement,
} from './classroom.ts';
export {
  publishDueAnnouncements,
  publishScheduledAnnouncement,
  type ScheduledPublishResult,
  type ScheduledPublishSkip,
} from './publish.ts';
export {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH,
  ANNOUNCEMENT_LINK_URL_MAX_LENGTH,
  ANNOUNCEMENT_PAGE_DEFAULT_LIMIT,
  ANNOUNCEMENT_PINNED_MAX,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TARGET_TYPE,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MIN_LENGTH,
  type AnnouncementStatus,
  isAnnouncementStatus,
} from './rules.ts';
