import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ID,
  calls,
  defaultRoutes,
  problem,
  type Routes,
  type StaffRole,
} from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { COURSE_ID } from '../../test/courses';
import { findMenu, renderApp } from '../../test/render';
import { STUDENT_ID, userSummary } from '../../test/users';

type Certificate = AdminSchemas['Certificate'];

const ISSUED_ID = '0193a5b2-0000-7000-8000-0000000000d1';
const PREPARING_ID = '0193a5b2-0000-7000-8000-0000000000d2';
const REVOKED_ID = '0193a5b2-0000-7000-8000-0000000000d3';
const REMOVED_ID = '0193a5b2-0000-7000-8000-0000000000d4';

function certificate(overrides: Partial<Certificate> = {}): Certificate {
  return {
    id: ISSUED_ID,
    code: 'ABCD-EFGH-JKMN',
    state: 'issued',
    user: { id: STUDENT_ID, name: 'Bia Aluna' },
    course: { type: 'course', id: COURSE_ID, title: 'Curso de Python' },
    studentName: 'Beatriz Aluna',
    courseTitle: 'Curso de Python',
    instructorName: 'Ivo Instrutor',
    hours: 12,
    completedAt: '2026-11-20T10:00:00Z',
    issuedAt: '2026-11-20T10:01:00Z',
    issuedManually: false,
    issuedBy: null,
    issueReason: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    pdfRenderedAt: '2026-11-20T10:02:00Z',
    templateVersionId: '0193a5b2-0000-7000-8000-0000000000f1',
    ...overrides,
  } as Certificate;
}

const ISSUED = certificate();
const PREPARING = certificate({
  id: PREPARING_ID,
  code: 'PQRS-TUVW-XYZ2',
  state: 'preparing',
  pdfRenderedAt: null,
  issuedManually: true,
});
const REVOKED = certificate({
  id: REVOKED_ID,
  code: 'MNPQ-RSTU-VWXY',
  state: 'revoked',
  revokedAt: '2026-11-22T10:00:00Z',
  revokedBy: { id: ADMIN_ID, name: 'Ana Admin' },
  revokeReason: 'Fraude',
});
const REMOVED = certificate({
  id: REMOVED_ID,
  code: 'HJKM-NPQR-STUV',
  studentName: null,
  pdfRenderedAt: null,
});

interface Options {
  role?: StaffRole;
  items?: Certificate[];
  overrides?: Routes;
  path?: string;
}

/** Abre `/certificados` com a lista simulada; guarda as consultas feitas à lista. */
function open({
  role = 'admin',
  items = [ISSUED, PREPARING, REVOKED, REMOVED],
  overrides = {},
  path = '/certificados',
}: Options = {}) {
  const queries: URLSearchParams[] = [];
  const bodies: Record<string, unknown>[] = [];
  const record = (result: object) => async (request: Request) => {
    bodies.push((await request.json()) as Record<string, unknown>);
    return result;
  };
  const routes: Routes = {
    ...defaultRoutes(role),
    'GET /api/v1/certificates': (request: Request) => {
      queries.push(new URL(request.url).searchParams);
      return { items, nextCursor: null };
    },
    'GET /api/v1/users': { items: [userSummary()], nextCursor: null },
    'GET /api/v1/courses': {
      items: [{ id: COURSE_ID, title: 'Curso de Python', status: 'published', archivedAt: null }],
      nextCursor: null,
    },
    'POST /api/v1/certificates': record(certificate({ issuedManually: true })),
    [`POST /api/v1/certificates/${ISSUED_ID}/revoke`]: record(
      certificate({ state: 'revoked', revokedAt: '2026-11-25T10:00:00Z' }),
    ),
    [`POST /api/v1/certificates/${REVOKED_ID}/restore`]: {
      ...REVOKED,
      state: 'issued',
      revokedAt: null,
    },
    [`POST /api/v1/certificates/${ISSUED_ID}/reissue`]: ISSUED,
    ...overrides,
  };
  const view = renderApp(path, routes);
  return { ...view, queries, bodies };
}

const table = async () => (await screen.findByRole('table')) as HTMLElement;
const rowOf = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;

describe('certificados (/certificados)', () => {
  it('lista os certificados com situação, PDF e ações do admin, sem violações do axe', async () => {
    open();
    const list = await table();
    expect(within(list).getAllByText('Beatriz Aluna')).toHaveLength(3);
    expect(within(list).getByText('Titular removeu a conta')).toBeTruthy();

    const issued = rowOf(ISSUED.code);
    expect(within(issued).getByText('Emitido')).toBeTruthy();
    expect(within(issued).getByText('12 horas')).toBeTruthy();
    expect(
      within(issued).getByRole('button', { name: `Baixar o PDF do certificado ${ISSUED.code}` }),
    ).toBeTruthy();
    expect(
      within(issued).getByRole('button', { name: `Reemitir o certificado ${ISSUED.code}` }),
    ).toBeTruthy();
    expect(
      within(issued).getByRole('button', { name: `Revogar o certificado ${ISSUED.code}` }),
    ).toBeTruthy();

    // em preparação: o aviso no lugar do botão
    const preparing = rowOf(PREPARING.code);
    expect(within(preparing).getAllByText('Em preparação')).toHaveLength(2);
    expect(within(preparing).getByText('Emissão manual')).toBeTruthy();
    expect(within(preparing).queryByRole('button', { name: /Baixar/ })).toBeNull();

    // revogado: o PDF continua com a equipe, e a revogação pode ser desfeita
    const revoked = rowOf(REVOKED.code);
    expect(within(revoked).getByText('Revogado')).toBeTruthy();
    expect(within(revoked).getByRole('button', { name: /Baixar o PDF/ })).toBeTruthy();
    expect(
      within(revoked).getByRole('button', {
        name: `Desfazer a revogação do certificado ${REVOKED.code}`,
      }),
    ).toBeTruthy();
    expect(within(revoked).queryByRole('button', { name: /^Reemitir/ })).toBeNull();

    // conta excluída: sem nome e sem PDF
    const removed = rowOf(REMOVED.code);
    expect(within(removed).getByText('PDF indisponível')).toBeTruthy();
    expect(within(removed).queryByRole('button', { name: /^Reemitir/ })).toBeNull();

    expect(screen.getByRole('button', { name: 'Emitir certificado' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('instrutor vê a lista e baixa o PDF, sem emitir, reemitir nem revogar', async () => {
    open({ role: 'instructor' });
    const menu = await findMenu();
    expect(within(menu).getByRole('link', { name: 'Certificados' })).toBeTruthy();
    const list = await table();
    expect(within(list).getAllByRole('button', { name: /Baixar o PDF/ })).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: /Reemitir|Revogar|Desfazer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Emitir certificado' })).toBeNull();
    // o nome não leva à ficha do aluno, que o instrutor não abre
    expect(within(list).queryByRole('link', { name: 'Beatriz Aluna' })).toBeNull();
  });

  it('gerente emite e reemite, mas não revoga', async () => {
    open({ role: 'manager' });
    const list = await table();
    expect(within(list).getAllByRole('button', { name: /^Reemitir/ })).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: /Revogar|Desfazer/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Emitir certificado' })).toBeTruthy();
  });

  it('filtra por código e situação pelo endereço', async () => {
    const user = userEvent.setup();
    const { queries, router } = open();
    await table();
    expect(queries[0]?.get('limit')).toBe('25');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar pelo código' }), 'ABCD');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await user.click(screen.getByRole('button', { name: 'Situação: Todas as situações' }));
    await user.click(screen.getByRole('option', { name: 'Revogado' }));
    await waitFor(() => {
      expect(Object.fromEntries(queries.at(-1) ?? [])).toMatchObject({
        code: 'ABCD',
        state: 'revoked',
      });
    });
    expect(router.state.location.search).toContain('state=revoked');
  });

  it('filtro de curso e de aluno vindo do endereço, removível', async () => {
    const user = userEvent.setup();
    const { queries } = open({ path: `/certificados?courseId=${COURSE_ID}&userId=${STUDENT_ID}` });
    await table();
    expect(Object.fromEntries(queries[0] ?? [])).toMatchObject({
      courseId: COURSE_ID,
      userId: STUDENT_ID,
    });
    expect(screen.getByText('Curso: Curso de Python')).toBeTruthy();
    expect(screen.getByText('Aluno: Bia Aluna')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remover o filtro de curso' }));
    await waitFor(() => expect(queries.at(-1)?.get('courseId')).toBeNull());
    expect(queries.at(-1)?.get('userId')).toBe(STUDENT_ID);
  });

  describe('baixar PDF', () => {
    const saved: { name: string; type: string }[] = [];
    beforeEach(() => {
      saved.length = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        saved.push({ name: '', type: (blob as Blob).type });
        return 'blob:certificado';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        const last = saved.at(-1);
        if (last) last.name = this.download;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('baixa o arquivo certificado-<código>.pdf', async () => {
      const user = userEvent.setup();
      open({
        overrides: {
          [`GET /api/v1/certificates/${ISSUED_ID}/pdf`]: () =>
            new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
              headers: { 'Content-Type': 'application/pdf' },
            }),
        },
      });
      await table();
      await user.click(
        screen.getByRole('button', { name: `Baixar o PDF do certificado ${ISSUED.code}` }),
      );
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]?.name).toBe(`certificado-${ISSUED.code}.pdf`);
    });

    it('409 certificate_preparing e 404 viram aviso, não erro de tela', async () => {
      const user = userEvent.setup();
      open({
        overrides: {
          [`GET /api/v1/certificates/${ISSUED_ID}/pdf`]: problem(409, 'certificate_preparing'),
          [`GET /api/v1/certificates/${REVOKED_ID}/pdf`]: problem(404, 'not_found'),
        },
      });
      await table();
      await user.click(
        screen.getByRole('button', { name: `Baixar o PDF do certificado ${ISSUED.code}` }),
      );
      expect(
        await screen.findByText(
          `O PDF do certificado ${ISSUED.code} ainda está em preparação. Tente de novo em instantes.`,
        ),
      ).toBeTruthy();
      await user.click(
        screen.getByRole('button', { name: `Baixar o PDF do certificado ${REVOKED.code}` }),
      );
      expect(
        await screen.findByText(`O PDF do certificado ${REVOKED.code} não está mais disponível.`),
      ).toBeTruthy();
      expect(saved).toHaveLength(0);
      // a lista continua à vista
      expect(screen.getByRole('table')).toBeTruthy();
    });
  });

  it('revogar pede motivo e o envia', async () => {
    const user = userEvent.setup();
    const { bodies, fetchMock } = open();
    await table();
    await user.click(screen.getByRole('button', { name: `Revogar o certificado ${ISSUED.code}` }));
    const box = await screen.findByRole('dialog', {
      name: `Revogar o certificado ${ISSUED.code}?`,
    });
    await user.click(within(box).getByRole('button', { name: 'Revogar' }));
    expect(await within(box).findByText('Preencha este campo.')).toBeTruthy();
    expect(calls(fetchMock)).not.toContain(`POST /api/v1/certificates/${ISSUED_ID}/revoke`);

    await user.type(within(box).getByRole('textbox', { name: 'Motivo' }), 'Fraude na prova');
    await user.click(within(box).getByRole('button', { name: 'Revogar' }));
    expect(await screen.findByText(`Certificado ${ISSUED.code} revogado.`)).toBeTruthy();
    expect(bodies).toEqual([{ reason: 'Fraude na prova' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('desfaz a revogação com confirmação', async () => {
    const user = userEvent.setup();
    const { fetchMock } = open();
    await table();
    await user.click(
      screen.getByRole('button', { name: `Desfazer a revogação do certificado ${REVOKED.code}` }),
    );
    const box = await screen.findByRole('alertdialog', { name: /Desfazer a revogação\?/ });
    await user.click(within(box).getByRole('button', { name: 'Desfazer revogação' }));
    expect(
      await screen.findByText(`Revogação do certificado ${REVOKED.code} desfeita.`),
    ).toBeTruthy();
    expect(calls(fetchMock)).toContain(`POST /api/v1/certificates/${REVOKED_ID}/restore`);
  });

  it('reemissão sem template mostra o 422 com o link para o template do curso', async () => {
    const user = userEvent.setup();
    open({
      overrides: {
        [`POST /api/v1/certificates/${ISSUED_ID}/reissue`]: problem(
          422,
          'certificate_template_missing',
        ),
      },
    });
    await table();
    await user.click(screen.getByRole('button', { name: `Reemitir o certificado ${ISSUED.code}` }));
    const box = await screen.findByRole('alertdialog', { name: /Reemitir o certificado\?/ });
    await user.click(within(box).getByRole('button', { name: 'Reemitir' }));
    expect(await screen.findByText('O curso não tem template de certificado')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Abrir o template do curso' });
    expect(link.getAttribute('href')).toBe(`/cursos/${COURSE_ID}?aba=template`);
  });

  describe('emissão manual', () => {
    async function fill(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Emitir certificado' }));
      const box = await screen.findByRole('dialog', { name: 'Emitir certificado manualmente' });
      await user.click(await within(box).findByRole('button', { name: 'Escolher Bia Aluna' }));
      await user.click(
        await within(box).findByRole('button', { name: 'Escolher Curso de Python' }),
      );
      await user.type(within(box).getByRole('textbox', { name: 'Motivo' }), 'Turma migrada');
      return box;
    }

    it('exige aluno, curso e motivo; emite com os três', async () => {
      const user = userEvent.setup();
      const { bodies } = open();
      await table();
      await user.click(screen.getByRole('button', { name: 'Emitir certificado' }));
      const box = await screen.findByRole('dialog', { name: 'Emitir certificado manualmente' });
      await user.click(within(box).getByRole('button', { name: 'Emitir' }));
      expect(await within(box).findByText('Escolha o aluno.')).toBeTruthy();
      expect(within(box).getByText('Escolha o curso.')).toBeTruthy();
      expect(bodies).toHaveLength(0);
      await expectNoAxeViolations();

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      const filled = await fill(user);
      await user.click(within(filled).getByRole('button', { name: 'Emitir' }));
      expect(
        await screen.findByText(
          `Certificado ${ISSUED.code} emitido para Beatriz Aluna. O PDF fica pronto em instantes.`,
        ),
      ).toBeTruthy();
      expect(bodies).toEqual([
        { userId: STUDENT_ID, courseId: COURSE_ID, reason: 'Turma migrada' },
      ]);
    });

    it('curso sem template: o 422 aponta o template do curso', async () => {
      const user = userEvent.setup();
      open({
        overrides: { 'POST /api/v1/certificates': problem(422, 'certificate_template_missing') },
      });
      await table();
      const box = await fill(user);
      await user.click(within(box).getByRole('button', { name: 'Emitir' }));
      expect(await within(box).findByText('O curso não tem template de certificado')).toBeTruthy();
      expect(
        within(box).getByRole('link', { name: 'Abrir o template do curso' }).getAttribute('href'),
      ).toBe(`/cursos/${COURSE_ID}?aba=template`);
    });

    it('aluno que já tem o certificado: 409 com o texto próprio', async () => {
      const user = userEvent.setup();
      open({ overrides: { 'POST /api/v1/certificates': problem(409, 'certificate_exists') } });
      await table();
      const box = await fill(user);
      await user.click(within(box).getByRole('button', { name: 'Emitir' }));
      expect(
        await within(box).findByText('Este aluno já tem certificado deste curso.'),
      ).toBeTruthy();
    });
  });
});
