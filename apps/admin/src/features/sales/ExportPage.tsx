import { AdminButton, AdminPageHeader, Alert, useToast } from '@nuva-edu/ui';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { saveBlob } from '../../api/download';
import { hasSalesFilters, readSalesFilters, salesQuery } from './filters';
import { useSalesError } from './format';
import { csvFileName, fetchOrdersCsv, ORDER_STATUSES } from './queries';
import { SalesFiltersBar } from './SalesFiltersBar';

/**
 * Exportar vendas (`/pedidos/exportar`, `sales.export`, só admin; spec 011, "Consulta e
 * exportação"): os mesmos filtros da lista e o download do CSV. A leitura é auditada pela API,
 * inclusive quando recusada; a tela nunca mostra o conteúdo, só entrega o arquivo.
 */
export function ExportPage() {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const message = useSalesError();
  const [params, setParams] = useSearchParams();
  const filters = readSalesFilters(params, ORDER_STATUSES);

  const download = useAction(async () => {
    const text = await fetchOrdersCsv(api, salesQuery(filters));
    // UTF-8 com BOM, `;` e vírgula decimal vêm da API; aqui só se entrega o arquivo ao navegador.
    saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), csvFileName());
    return text;
  });

  const onDownload = async () => {
    const result = await download.run();
    if (result.ok) toast.success(t('sales.export.done'));
  };

  const update = (key: string, value: string | undefined) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });

  return (
    <>
      <AdminPageHeader title={t('menu.items.exportSales')} subtitle={t('sales.export.subtitle')} />
      <p className="mt-0 mb-4 max-w-3xl text-sm text-ink-3">
        {hasSalesFilters(filters) ? t('sales.export.filteredHint') : t('sales.export.allHint')}
      </p>
      <SalesFiltersBar filters={filters} onChange={update} onClear={clear} />
      {download.error ? (
        <Alert tone="error" className="mb-4">
          {message(download.error)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <AdminButton
          variant="primary"
          icon={<Download size={16} aria-hidden="true" />}
          disabled={download.busy}
          aria-busy={download.busy || undefined}
          onClick={() => void onDownload()}
        >
          {download.busy ? t('sales.export.busy') : t('sales.export.download')}
        </AdminButton>
        <span className="text-sm text-ink-3">{t('sales.export.format')}</span>
      </div>
      <p role="status" className="mt-4 max-w-3xl text-sm text-ink-3">
        {t('sales.export.columns')}
      </p>
    </>
  );
}
