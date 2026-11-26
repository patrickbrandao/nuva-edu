import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { COURSE, COURSE_ITEM, EBOOK_ITEM } from '../test/catalog';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';
import { cart, cartItem, ITEMS_URL } from '../test/sales';

const session = makeSession();
const t = ptBR.sales.buy;
const COURSE_URL = 'GET /api/v1/catalog/course/react-do-zero';
const CATALOG_URL = 'GET /api/v1/catalog';
const addLabel = t.addNamed.replace('{{title}}', COURSE.title);

/** Página do curso pago, com a compra ao lado do bloqueio. */
const productRoutes = (extra: Parameters<typeof apiRoutes>[0] = {}) =>
  apiRoutes({ [COURSE_URL]: () => jsonResponse(COURSE), ...extra });

describe('"Adicionar à cesta"', () => {
  it('a vitrine oferece a cesta nos produtos pagos a quem está logado', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/',
      apiRoutes({
        [CATALOG_URL]: () => jsonResponse({ items: [COURSE_ITEM, EBOOK_ITEM], nextCursor: null }),
        [ITEMS_URL]: () => jsonResponse(cart()),
      }),
      { session },
    );

    const action = await screen.findByRole('button', { name: addLabel });
    // o ebook gratuito não tem cesta na vitrine
    expect(
      screen.queryByRole('button', { name: t.addNamed.replace('{{title}}', EBOOK_ITEM.title) }),
    ).toBeNull();

    await user.click(action);
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/api/v1/cart/items' &&
            JSON.stringify(call.body) ===
              JSON.stringify({ productType: 'course', productId: COURSE_ITEM.id }),
        ),
      ).toBe(true),
    );
  });

  it('põe o produto na cesta e avisa pelo nome', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/cursos/react-do-zero',
      productRoutes({ [ITEMS_URL]: () => jsonResponse(cart({ items: [cartItem()] })) }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: addLabel }));

    expect(await screen.findByText(t.done.replace('{{title}}', COURSE.title))).toBeTruthy();
    const added = calls.find(
      (call) => call.method === 'POST' && call.path === '/api/v1/cart/items',
    );
    expect(added?.body).toEqual({ productType: 'course', productId: COURSE.id });
    expect(added?.csrf).toBe(session.csrfToken);
  });

  it('produto que já está na cesta vira um aviso com o motivo', async () => {
    const user = userEvent.setup();
    renderApp(
      '/cursos/react-do-zero',
      productRoutes({
        [ITEMS_URL]: () => problemResponse(409, 'product_already_in_cart'),
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: addLabel }));

    const alert = await findAlert();
    expect(alert.textContent).toContain(t.errors.inCart);
    expect(screen.getByRole('button', { name: addLabel }).hasAttribute('disabled')).toBe(false);
  });

  it('durante o envio o botão fica ocupado e não repete o pedido', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderApp(
      '/cursos/react-do-zero',
      productRoutes({
        [ITEMS_URL]: async () => {
          await pending;
          return jsonResponse(cart());
        },
      }),
      { session },
    );

    await user.click(await screen.findByRole('button', { name: addLabel }));

    const busy = screen.getByRole('button', { name: addLabel });
    await waitFor(() => expect(busy.hasAttribute('disabled')).toBe(true));
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.textContent).toBe(t.adding);

    release?.();
    await waitFor(() => expect(screen.getByRole('button', { name: addLabel })).toBeTruthy());
  });
});
