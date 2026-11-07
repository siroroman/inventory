import type { InventoryDto } from '@inventory/shared';
import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { saveFile } from '@/lib/save-file';
import { fetchInventoryExport } from './api';
import { inventoryCsv, inventoryCsvFileName } from './export-csv';

/**
 * "Stáhnout CSV" on a run's overview, for every role and every state (a run in progress gives the
 * state of the moment). The rows are fetched fresh, made into the CSV in the browser and saved; a
 * failure is toasted by the query client.
 */
export function InventoryExport({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const download = useMutation({
    mutationFn: () => fetchInventoryExport(inventory.id),
    onSuccess: ({ items }) => {
      saveFile(new Blob([inventoryCsv(items)], { type: 'text/csv;charset=utf-8' }), inventoryCsvFileName(inventory));
      toast.success(t('inventory.export.done'));
    },
  });

  return (
    <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
      <Download aria-hidden />
      {t('inventory.actions.exportCsv')}
    </Button>
  );
}
