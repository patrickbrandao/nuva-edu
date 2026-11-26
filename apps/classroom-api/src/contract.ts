import { type Contract, loadContract } from '@nuva-edu/api-kit';

/** O contrato desta API. É do papel `arquiteto`: aqui ele só é lido. */
export const CONTRACT_FILE = new URL('../openapi.yaml', import.meta.url);

export function loadClassroomContract(): Contract {
  return loadContract(CONTRACT_FILE);
}

/**
 * `operationId` das operações de escrita que não exigem `csrfToken` (spec 004, "Autenticação e
 * autorização"; spec 007, "CSRF nas rotas públicas de autenticação"). Cada entrada precisa do
 * motivo na descrição da operação no contrato; o teste de contrato falha se uma escrita sem
 * `csrfToken` não estiver aqui, e também se uma entrada daqui deixar de ser exceção.
 */
export const CSRF_EXCEPTIONS: readonly string[] = [
  // Escritas sem sessão (spec 007): ainda não há token CSRF. Protegidas por aceitarem só
  // `application/json` (outro tipo: 415; sem CORS, um formulário de outro site não envia JSON)
  // e pelo cookie de sessão `SameSite=Lax`.
  'register', // POST /auth/register: cadastro, antes de existir sessão.
  'login', // POST /auth/login: é ele que cria a sessão e o token.
  'verifyEmail', // POST /auth/email/verify: quem abre o link pode não ter sessão.
  'requestPasswordReset', // POST /auth/password/forgot: quem esqueceu a senha não tem sessão.
  'resetPassword', // POST /auth/password/reset: quem redefine a senha não tem sessão.
  'completeSocialSignup', // POST /auth/social/complete: conclui o cadastro social, ainda sem sessão.
  // Retorno OAuth (spec 007, passo 3): quem envia é o provedor, protegido pelo `state`.
  'oauthCallbackForm', // POST /auth/{provider}/callback: form_post da Apple.
  // Webhook do provedor de pagamento (spec 013, "Webhook"): quem chama é o Mercado Pago, não um
  // navegador com a sessão do aluno; a autenticação é a assinatura `x-signature`. Público
  // (`security: []`), lê o corpo bruto com limite de 64 KB. É a rota
  // `POST /api/v1/webhooks/mercadopago`.
  'receiveMercadoPagoWebhook',
  // Descadastro por token (spec 024, "Links com token"): link de um clique no cliente de e-mail,
  // aberto sem sessão e sem token CSRF. Público (`security: []`), sem corpo; o token do caminho é
  // a autenticação e o efeito é só desligar o e-mail de um grupo. É a rota
  // `POST /api/v1/unsubscribe/{token}`.
  'unsubscribe',
];
