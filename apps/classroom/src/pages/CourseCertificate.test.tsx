import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  CERTIFICATE_CODE,
  CERTIFICATE_ID,
  ISSUED_COURSE_CERTIFICATE,
  makeCourseCertificate,
  pdfResponse,
} from '../test/certificates';
import { COURSE_PATH, makeCourseView } from '../test/learning';
import { apiRoutes, jsonResponse, makeSession, renderApp } from '../test/renderApp';
import { fakeShelf, makeShelfCourse } from '../test/shelf';

type CourseCertificateState = ClassroomSchemas['CourseCertificateState'];

const t = ptBR.certificates;
const COURSE = 'GET /api/v1/courses/react-do-zero';
const PDF = `GET /api/v1/me/certificates/${CERTIFICATE_ID}/pdf`;
const session = makeSession();
const course = (certificate: CourseCertificateState | null) =>
  apiRoutes({ [COURSE]: () => jsonResponse(makeCourseView({ certificate })) });
const block = async () => within(await screen.findByRole('region', { name: t.section.title }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('certificado na página do curso', () => {
  it('certificado desabilitado (`null`) não menciona certificado', async () => {
    renderApp(COURSE_PATH, course(null), { session });
    expect(await screen.findByRole('heading', { level: 1, name: 'React do zero' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: t.section.title })).toBeNull();
    expect(screen.queryByText(/certificado/i)).toBeNull();
  });

  it('em andamento mostra o nome que sairá, com "Alterar" que grava o nome', async () => {
    const user = userEvent.setup();
    let saved: unknown;
    let fresh = makeCourseView({ certificate: makeCourseCertificate() });
    const { calls } = renderApp(
      COURSE_PATH,
      apiRoutes({
        [COURSE]: () => jsonResponse(fresh),
        'PUT /api/v1/me/certificate-name': async (request) => {
          saved = await request.json();
          fresh = makeCourseView({
            certificate: makeCourseCertificate({ studentName: 'Ana Souza Lima' }),
          });
          return jsonResponse({ fullName: 'Ana Souza Lima', studentName: 'Ana Souza Lima' });
        },
      }),
      { session },
    );

    const box = await block();
    expect(box.getByRole('heading', { level: 2, name: t.state.in_progress })).toBeTruthy();
    expect(box.getByText(t.name.label)).toBeTruthy();
    expect(box.getByText('Ana Souza')).toBeTruthy();
    expect(box.queryByRole('button', { name: /Baixar/ })).toBeNull();
    await expectNoAxeViolations();

    await user.click(box.getByRole('button', { name: t.name.changeLabel }));
    const dialog = within(await screen.findByRole('dialog', { name: t.name.dialogTitle }));
    const field = dialog.getByRole('textbox', { name: t.name.field });
    await user.clear(field);
    await user.type(field, 'Ana Souza Lima');
    await user.click(dialog.getByRole('button', { name: t.name.save }));

    // a página do curso consulta de novo e mostra o nome novo
    expect(await box.findByText('Ana Souza Lima')).toBeTruthy();
    expect(saved).toEqual({ fullName: 'Ana Souza Lima' });
    expect(calls.filter((call) => call.path === '/api/v1/courses/react-do-zero')).toHaveLength(2);
  });

  it('concluído sem template mostra o aviso e nenhum botão de download', async () => {
    renderApp(COURSE_PATH, course(makeCourseCertificate({ state: 'awaiting_template' })), {
      session,
    });
    const box = await block();
    expect(box.getByRole('heading', { level: 2, name: t.state.awaiting_template })).toBeTruthy();
    expect(box.queryByRole('button')).toBeNull();
    expect(box.queryByText(t.name.label)).toBeNull();
  });

  it('em preparação e revogado: só o estado, com o nome congelado', async () => {
    renderApp(
      COURSE_PATH,
      course(makeCourseCertificate({ state: 'preparing', certificateId: CERTIFICATE_ID })),
      { session },
    );
    const box = await block();
    expect(box.getByRole('heading', { level: 2, name: t.state.preparing })).toBeTruthy();
    expect(box.getByText('Ana Souza')).toBeTruthy();
    expect(box.queryByRole('button')).toBeNull();
  });

  it('revogado não oferece o download', async () => {
    renderApp(COURSE_PATH, course({ ...ISSUED_COURSE_CERTIFICATE, state: 'revoked' }), { session });
    const box = await block();
    expect(box.getByRole('heading', { level: 2, name: t.state.revoked })).toBeTruthy();
    expect(box.queryByRole('button')).toBeNull();
    expect(box.queryByRole('link')).toBeNull();
  });

  it('emitido traz o código, a validação e o download do PDF', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(browser, 'saveFile').mockImplementation(() => {});
    renderApp(
      COURSE_PATH,
      apiRoutes({
        [COURSE]: () => jsonResponse(makeCourseView({ certificate: ISSUED_COURSE_CERTIFICATE })),
        [PDF]: () => pdfResponse(),
      }),
      { session },
    );
    const box = await block();
    expect(box.getByRole('heading', { level: 2, name: t.state.issued })).toBeTruthy();
    expect(box.getByText(`Código: ${CERTIFICATE_CODE}`, { exact: false })).toBeTruthy();
    expect(box.getByRole('link', { name: t.section.validate }).getAttribute('href')).toBe(
      `/certificados/${CERTIFICATE_CODE}`,
    );
    await user.click(box.getByRole('button', { name: 'Baixar certificado: React do zero' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe(`certificado-${CERTIFICATE_CODE}.pdf`);
  });
});

describe('certificado nos cursos da estante', () => {
  it('cada curso mostra o estado; o emitido baixa o PDF; a estante leva aos certificados', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(browser, 'saveFile').mockImplementation(() => {});
    const courses = [
      makeShelfCourse({ certificate: ISSUED_COURSE_CERTIFICATE }),
      makeShelfCourse({
        id: '0193a5b2-0000-7000-8000-0000000000c3',
        slug: 'css-moderno',
        title: 'CSS moderno',
        certificate: makeCourseCertificate({ state: 'awaiting_template' }),
      }),
      makeShelfCourse({
        id: '0193a5b2-0000-7000-8000-0000000000c2',
        slug: 'node-na-pratica',
        title: 'Node na prática',
        certificate: makeCourseCertificate(),
      }),
    ];
    renderApp(
      '/meus-cursos',
      apiRoutes({
        ...fakeShelf(courses),
        'GET /api/v1/samples': () => jsonResponse({ items: [], nextCursor: null }),
        [PDF]: () => pdfResponse(),
      }),
      { session },
    );
    const card = async (title: string) =>
      within(
        (await screen.findByRole('heading', { level: 3, name: title })).closest(
          'article',
        ) as HTMLElement,
      );

    const react = await card('React do zero');
    expect(react.getByText(t.state.issued)).toBeTruthy();
    const css = await card('CSS moderno');
    expect(css.getByText(t.state.awaiting_template)).toBeTruthy();
    expect(css.queryByRole('button', { name: /Baixar/ })).toBeNull();
    const node = await card('Node na prática');
    expect(node.getByText(t.state.in_progress)).toBeTruthy();
    expect(node.queryByRole('button', { name: /Baixar/ })).toBeNull();

    expect(
      screen.getByRole('link', { name: ptBR.study.shelf.certificates }).getAttribute('href'),
    ).toBe('/progresso#certificados');
    await expectNoAxeViolations();

    await user.click(react.getByRole('button', { name: 'Baixar certificado: React do zero' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
