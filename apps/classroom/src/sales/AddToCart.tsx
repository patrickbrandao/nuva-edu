import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { AdminButton, useToast } from '@nuva-edu/ui';
import { ShoppingBasket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { describeError } from '../api/errors';
import { safeReturnTo, withReturnTo } from '../session/returnTo';
import { useSession } from '../session/session';
import { LOGIN_PATH } from '../shell/navigation';
import { useAddCartItem } from './queries';

interface AddToCartProps {
  productType: ClassroomSchemas['ProductType'];
  productId: string;
  /** Título do produto, para o nome acessível do botão e o aviso. */
  title: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'default';
  className?: string | undefined;
}

/**
 * "Adicionar à cesta" (spec 011, RF-01). Sem sessão, leva a `/entrar` guardando a página atual:
 * o cadastro de compra exige conta. A recusa da API (já na cesta, já possuído, cesta cheia,
 * e-mail não confirmado) vira um aviso passageiro com o motivo, sem tirar a pessoa da tela.
 */
export function AddToCart({
  productType,
  productId,
  title,
  size = 'md',
  variant = 'primary',
  className,
}: AddToCartProps) {
  const { t } = useTranslation();
  const { session } = useSession();
  const { pathname, search } = useLocation();
  const toast = useToast();
  const add = useAddCartItem();
  const label = t('sales.buy.add');
  const named = t('sales.buy.addNamed', { title });

  if (!session) {
    return (
      <AdminButton
        href={withReturnTo(LOGIN_PATH, safeReturnTo(pathname + search))}
        size={size}
        variant={variant}
        icon={<ShoppingBasket size={14} aria-hidden="true" />}
        className={className}
      >
        {label}
      </AdminButton>
    );
  }

  const submit = () => {
    add.mutate(
      { productType, productId },
      {
        onSuccess: () => toast.success(t('sales.buy.done', { title })),
        onError: (error) => {
          const failure = describeError(t, error, {
            product_already_in_cart: t('sales.buy.errors.inCart'),
            product_already_owned: t('sales.buy.errors.owned'),
            product_not_sellable: t('sales.buy.errors.notSellable'),
            cart_full: t('sales.buy.errors.full'),
            email_not_verified: t('sales.buy.errors.emailNotVerified'),
          });
          toast.error(failure.message, { title: t('sales.buy.errorTitle') });
        },
      },
    );
  };

  return (
    <AdminButton
      size={size}
      variant={variant}
      icon={<ShoppingBasket size={14} aria-hidden="true" />}
      onClick={submit}
      disabled={add.isPending}
      aria-label={named}
      aria-busy={add.isPending || undefined}
      className={className}
    >
      {add.isPending ? t('sales.buy.adding') : label}
    </AdminButton>
  );
}
