import { type FastifyRequest, type RateLimitRule, rateLimitByIp } from '@nuva-edu/api-kit';
import { session } from './session.ts';

/**
 * Operações de login, cadastro e redefinição: 10 por minuto por IP (spec 004, RNF-04). Do login
 * social contam o início e a conclusão do cadastro; o retorno vem do provedor, depois do início.
 */
export const AUTH_RATE_LIMITED_OPERATIONS: readonly string[] = [
  'register',
  'login',
  'startOAuth',
  'completeSocialSignup',
  'requestPasswordReset',
  'resetPassword',
];

/**
 * Entrega de imagem: fora dos limites por sessão e por visitante, com conta própria por IP
 * (spec 029, "Limite de taxa da entrega"; spec 004, RNF-04).
 */
export const IMAGE_DELIVERY_OPERATIONS: readonly string[] = ['getImageVariant'];

/** Validação pública do certificado: conta própria por IP (spec 015, RNF-05). */
export const CERTIFICATE_VERIFY_OPERATIONS: readonly string[] = ['verifyCertificate'];

/** Webhook do provedor de pagamento: conta própria de 300 por minuto por IP (spec 013). */
export const WEBHOOK_OPERATIONS: readonly string[] = ['receiveMercadoPagoWebhook'];

function hasOwnRateLimitBucket(request: FastifyRequest): boolean {
  const operationId = request.operation?.operationId;
  return (
    operationId !== undefined &&
    (IMAGE_DELIVERY_OPERATIONS.includes(operationId) || WEBHOOK_OPERATIONS.includes(operationId))
  );
}

/**
 * Limites de taxa da classroom-api (spec 004, RNF-04; spec 013), em memória por processo. Os de
 * mensagem direta e de fórum entram com os recursos (Fases 4 e 6).
 *
 * - `session`: 120 por minuto por sessão, nas operações com sessão, exceto entrega de imagem e webhook.
 * - `visitor`: 60 por minuto por IP, nas requisições sem sessão, exceto entrega de imagem e webhook.
 * - `auth-ip`: 10 por minuto por IP em login, cadastro e redefinição de senha.
 * - `image-ip`: 600 por minuto por IP na entrega de imagem, com ou sem sessão; `304` conta.
 * - `certificate-verify-ip`: 30 por minuto por IP na validação pública do certificado, com ou
 *   sem sessão (spec 015, RNF-05), além do limite de visitante ou de sessão.
 * - `webhook-ip`: 300 por minuto por IP no recebimento de webhook, inclusive rejeições (spec 013).
 */
export const CLASSROOM_RATE_LIMITS: readonly RateLimitRule[] = [
  {
    name: 'session',
    limit: 120,
    windowSeconds: 60,
    key: (request) => (hasOwnRateLimitBucket(request) ? null : (session.get(request)?.id ?? null)),
  },
  {
    name: 'visitor',
    limit: 60,
    windowSeconds: 60,
    key: (request) =>
      hasOwnRateLimitBucket(request) || session.get(request) ? null : rateLimitByIp(request),
  },
  {
    name: 'auth-ip',
    limit: 10,
    windowSeconds: 60,
    key: rateLimitByIp,
    operations: AUTH_RATE_LIMITED_OPERATIONS,
  },
  {
    name: 'image-ip',
    limit: 600,
    windowSeconds: 60,
    key: rateLimitByIp,
    operations: IMAGE_DELIVERY_OPERATIONS,
  },
  {
    name: 'certificate-verify-ip',
    limit: 30,
    windowSeconds: 60,
    key: rateLimitByIp,
    operations: CERTIFICATE_VERIFY_OPERATIONS,
  },
  {
    name: 'webhook-ip',
    limit: 300,
    windowSeconds: 60,
    key: rateLimitByIp,
    operations: WEBHOOK_OPERATIONS,
  },
];
