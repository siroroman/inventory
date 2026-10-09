import type { InventoryDto } from '@inventory/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { invalidateAfterWrite } from '@/lib/query';
import { cancelInventory } from './api';

/**
 * "Zrušit inventuru" of a run in progress: a button, and a question first. Whoever renders it
 * decides who may see it.
 * A failure (someone cancelled it meanwhile, a stale version) is toasted by the query client.
 */
export function CancelInventory({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

  const cancel = useMutation({
    mutationFn: () => cancelInventory(inventory.id, inventory.version),
    onSuccess: () => toast.success(t('inventory.cancel.done')),
    // Also after a failure the open screen should show the run that won, with its version.
    onSettled: () => invalidateAfterWrite(queryClient),
  });

  return (
    <>
      <Button variant="outline" disabled={cancel.isPending} onClick={() => setAsking(true)}>
        <Ban aria-hidden />
        {t('inventory.actions.cancel')}
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('inventory.cancel.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('inventory.cancel.hint')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('inventory.cancel.back')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancel.mutate()}>{t('inventory.actions.cancel')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
