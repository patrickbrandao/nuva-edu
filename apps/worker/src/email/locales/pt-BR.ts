import type { EmailTemplates } from '../templates.ts';

// Textos dos e-mails em pt-BR (spec 024, "E-mails do grupo account e da Fase 1"). Um modelo por
// tipo: assunto, parágrafos e botões. O layout (texto e HTML) é montado em `../templates.ts`.
// Nunca ponha aqui senha nem motivo interno de suspensão; o token só entra pelo link pronto.

const ROLE_LABELS = {
  student: 'aluno',
  instructor: 'instrutor',
  manager: 'gerente',
  admin: 'administrador',
} as const;

const SITE_LABELS = {
  classroom: 'site do aluno',
  admin: 'painel de administração',
} as const;

export const ptBR: EmailTemplates = {
  greeting: (name) => `Olá, ${name}.`,
  linkHint: 'Se o botão não funcionar, copie e cole o endereço no navegador:',
  footer: (school) =>
    `Você recebeu este e-mail porque tem uma conta em ${school}. É uma mensagem automática: não responda.`,

  'account.verify_email': ({ school, links }) => ({
    subject: `Confirme seu e-mail em ${school}`,
    paragraphs: [
      `Falta pouco: confirme que este e-mail é seu para usar todos os recursos de ${school}.`,
      'O link vale por 24 horas e só pode ser usado uma vez. Se você não criou uma conta, ignore este e-mail.',
    ],
    actions: [{ label: 'Confirmar e-mail', url: links.classroom('/confirmar', true) }],
  }),

  'account.password_reset': ({ school, links }) => ({
    subject: `Redefina sua senha em ${school}`,
    paragraphs: [
      `Recebemos um pedido para redefinir a senha da sua conta em ${school}.`,
      'O link vale por 24 horas e só pode ser usado uma vez. Se você não pediu, ignore este e-mail: sua senha continua a mesma.',
    ],
    actions: [{ label: 'Redefinir senha', url: links.classroom('/redefinir', true) }],
  }),

  'account.exists': ({ school, links }) => ({
    subject: `Você já tem uma conta em ${school}`,
    paragraphs: [
      `Alguém tentou criar uma conta em ${school} com este e-mail, mas ele já está cadastrado.`,
      'Se foi você, entre com a sua conta ou redefina a senha, caso não se lembre dela. Se não foi você, ignore este e-mail: nada mudou na sua conta.',
    ],
    actions: [
      { label: 'Entrar', url: links.classroom('/entrar') },
      { label: 'Redefinir senha', url: links.classroom('/redefinir') },
    ],
  }),

  'account.new_login': ({ school, data, links, formatDateTime }) => ({
    subject: `Novo acesso à sua conta em ${school}`,
    paragraphs: [
      `Sua conta em ${school} foi acessada de um dispositivo novo, no ${SITE_LABELS[data.site]}.`,
      [
        `Quando: ${formatDateTime(data.at)}`,
        `Endereço IP: ${data.ip}`,
        `Navegador: ${data.browser ?? 'não identificado'}`,
        `Sistema: ${data.os ?? 'não identificado'}`,
      ].join('\n'),
      'Se foi você, não precisa fazer nada. Se não reconhece este acesso, encerre as sessões e troque a sua senha.',
    ],
    actions: [{ label: 'Ver acessos da conta', url: links.classroom('/conta/acesso') }],
  }),

  'account.locked': ({ school, data, links, formatDateTime }) => ({
    subject: `Sua conta em ${school} foi bloqueada temporariamente`,
    paragraphs: [
      `Houve várias tentativas de entrar na sua conta em ${school} com a senha errada. Por segurança, o login fica bloqueado até ${formatDateTime(data.until)}.`,
      'Se foi você e esqueceu a senha, redefina-a: a redefinição libera a conta na hora. Se não foi você, redefinir a senha também é o mais seguro.',
    ],
    actions: [{ label: 'Redefinir senha', url: links.classroom('/redefinir') }],
  }),

  'account.password_changed': ({ school, data, links }) => ({
    subject: `Sua senha em ${school} foi alterada`,
    paragraphs: [
      data.by === 'admin'
        ? `A senha da sua conta em ${school} foi definida por um administrador da escola.`
        : `A senha da sua conta em ${school} foi alterada.`,
      'As outras sessões abertas foram encerradas. Se você não reconhece esta mudança, redefina a senha agora.',
    ],
    actions: [{ label: 'Redefinir senha', url: links.classroom('/redefinir') }],
  }),

  'account.role_changed': ({ school, data, links }) => ({
    subject: `Seu papel em ${school} mudou`,
    paragraphs: [
      `Seu papel em ${school} agora é ${ROLE_LABELS[data.role]}.`,
      data.role === 'student'
        ? 'Você continua com acesso ao site do aluno.'
        : 'Com ele você também acessa o painel de administração.',
    ],
    actions:
      data.role === 'student'
        ? []
        : [{ label: 'Abrir o painel de administração', url: links.admin }],
  }),

  'moderation.suspended': ({ school, data, formatDateTime }) => ({
    subject: `Sua conta em ${school} foi suspensa`,
    paragraphs: [
      data.kind === 'posting'
        ? `Sua conta em ${school} está impedida de publicar: você continua entrando e assistindo às aulas, mas não pode postar nem enviar mensagens.`
        : `Sua conta em ${school} está suspensa: o acesso à plataforma está bloqueado.`,
      data.endsAt === null
        ? 'A suspensão não tem data para terminar.'
        : `A suspensão termina em ${formatDateTime(data.endsAt)}.`,
      'Em caso de dúvida, fale com a equipe da escola.',
    ],
    actions: [],
  }),
};
