import type { InventoryDto } from '@inventory/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, CheckCheck, RotateCcw } from 'lucide-react';
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
import { archiveInventory, cancelInventory, finishInventory, reopenInventory, restoreInventory } from './api';
import { runFigures } from './inventory-summary';

type Action = 'finish' | 'cancel' | 'reopen' | 'archive' | 'restore';

const request = {
  finish: finishInventory,
  cancel: cancelInventory,
  reopen: reopenInventory,
  archive: archiveInventory,
  restore: restoreInventory,
};

/**
 * The buttons of a run's overview: a run in progress can be finished or cancelled, a finished or
 * cancelled one reopened or archived, an archived one restored. Everything but
 * restoring asks first (the finish says how many items stay not checked and how many are missing).
 * Whoever renders it decides who may see it (writers).
 * A failure (somebody ended it meanwhile, a stale version) is toasted by the query client, and the
 * open screen refetches to show the run that won.
 */
export function InventoryActions({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Exclude<Action, 'restore'> | null>(null);

  const change = useMutation({
    mutationFn: (action: Action) => request[action](inventory.id, inventory.version),
    onSuccess: (_, action) => toast.success(t(`inventory.toast.${action}`)),
    // Also after a failure the open screen should show the run that won, with its version.
    onSettled: () => invalidateAfterWrite(queryClient),
  });

  // What the finish leaves not checked: the list without what is checked or flagged as missing.
  const { unchecked, missing } = runFigures(inventory.counts);
  const inProgress = inventory.status === 'in_progress';
  const archived = inventory.archivedAt !== null;
  // A finished or cancelled run (not archived) can be taken back or archived; an archived one is restored first.
  const canReopen = !inProgress && !archived;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {inProgress && (
          <>
            <Button disabled={change.isPending} onClick={() => setAsking('finish')}>
              <CheckCheck aria-hidden />
              {t('inventory.actions.finish')}
            </Button>
            <Button variant="outline" disabled={change.isPending} onClick={() => setAsking('cancel')}>
              <Ban aria-hidden />
              {t('inventory.actions.cancel')}
            </Button>
          </>
        )}
        {canReopen && (
          <Button variant="outline" disabled={change.isPending} onClick={() => setAsking('reopen')}>
            <RotateCcw aria-hidden />
            {t('inventory.actions.reopen')}
          </Button>
        )}
        {canReopen && (
          <Button variant="outline" disabled={change.isPending} onClick={() => setAsking('archive')}>
            <Archive aria-hidden />
            {t('inventory.actions.archive')}
          </Button>
        )}
        {archived && (
          <Button variant="outline" disabled={change.isPending} onClick={() => change.mutate('restore')}>
            <ArchiveRestore aria-hidden />
            {t('inventory.actions.restore')}
          </Button>
        )}
      </div>

      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent>
          {asking && (
            <>
              <AlertDialogTitle>{t(`inventory.${asking}.title`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {asking === 'finish'
                  ? [
                      unchecked > 0
                        ? t('inventory.finish.unchecked', { count: unchecked })
                        : missing === 0 && t('inventory.finish.hintNone'),
                      missing > 0 && t('inventory.finish.missing', { count: missing }),
                      unchecked > 0 && missing === 0 && t('inventory.finish.flagHint'),
                      t('inventory.finish.ends'),
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : t(`inventory.${asking}.hint`)}
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('inventory.back')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => change.mutate(asking)}>{t(`inventory.actions.${asking}`)}</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
