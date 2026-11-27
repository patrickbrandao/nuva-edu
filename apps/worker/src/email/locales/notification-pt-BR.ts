import type { NotificationType } from '@nuva-edu/core';

export const notificationSubjects = {
  'order.approved': 'Pagamento confirmado',
  'order.refunded': 'Pedido reembolsado',
  'subscription.renewed': 'Assinatura renovada',
  'subscription.payment_failed': 'Pagamento da assinatura recusado',
  'subscription.canceled': 'Assinatura cancelada',
  'subscription.expired': 'Acesso por assinatura encerrado',
  'access.revoked': 'Alteração no seu acesso',
  'lesson.published': 'Nova aula publicada',
  'course.published': 'Novo curso publicado',
  'forum.reply': 'Nova resposta no fórum',
  'forum.mention': 'Você recebeu uma menção',
  'forum.solution': 'Uma resposta foi marcada como solução',
  'dm.received': 'Nova mensagem direta',
  'follow.created': 'Novo seguidor',
  'case.liked': 'Curtiram seu case',
  'case.commented': 'Novo comentário no seu case',
  'badge.awarded': 'Você ganhou uma medalha',
  'level.up': 'Você subiu de nível',
  'event.created': 'Novo evento da escola',
  'event.reminder': 'Lembrete de evento',
  'event.canceled': 'Evento cancelado',
  'ticket.reply': 'Resposta ao seu chamado',
  'ticket.status_changed': 'Seu chamado mudou de status',
  'announcement.published': 'Novidade da escola',
  'moderation.content_hidden': 'Publicação ocultada pela moderação',
  'moderation.warning': 'Você recebeu um aviso da moderação',
  'ticket.opened': 'Novo chamado de suporte',
  'ticket.user_reply': 'Nova resposta do aluno no chamado',
  'report.created': 'Nova denúncia para moderar',
  'ops.job_failed': 'Tarefa em segundo plano precisa de atenção',
} satisfies Partial<Record<NotificationType, string>>;

export type NotificationTemplateType = keyof typeof notificationSubjects;

export const notificationCopy = {
  open: 'Abrir minhas notificações',
  unsubscribe: 'Desativar e-mails deste grupo',
  inSchool: (subject: string, school: string) => `${subject} · ${school}`,
};
