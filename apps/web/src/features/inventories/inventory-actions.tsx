import type { InventoryDto } from '@inventory/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, CheckCheck, MoreHorizontal } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { invalidateAfterWrite } from '@/lib/query';
import { archiveInventory, cancelInventory, finishInventory, restoreInventory } from './api';

type Action = 'finish' | 'cancel' | 'archive' | 'restore';

const request = { finish: finishInventory, cancel: cancelInventory, archive: archiveInventory, restore: restoreInventory };

/**
 * The "…" menu of a run's overview: a run in progress can be finished or cancelled, an ended one
 * archived, an archived one restored. Finishing, cancelling and archiving ask first; restoring
 * loses nothing and does not. Whoever renders it decides who may see it (writers).
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

  const { expected, checked } = inventory.counts;
  const unchecked = Math.max(expected - checked, 0);
  const inProgress = inventory.status === 'in_progress';
  const archived = inventory.archivedAt !== null;

  return (
    <>
      {/* Not modal, so the question opened from a menu item does not fight the menu for the focus lock. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t('inventory.actions.menu')} disabled={change.isPending}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {inProgress && (
            <>
              <DropdownMenuItem onSelect={() => setAsking('finish')}>
                <CheckCheck aria-hidden />
                {t('inventory.actions.finish')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAsking('cancel')}>
                <Ban aria-hidden />
                {t('inventory.actions.cancel')}
              </DropdownMenuItem>
            </>
          )}
          {!inProgress && !archived && (
            <DropdownMenuItem onSelect={() => setAsking('archive')}>
              <Archive aria-hidden />
              {t('inventory.actions.archive')}
            </DropdownMenuItem>
          )}
          {archived && (
            <DropdownMenuItem onSelect={() => change.mutate('restore')}>
              <ArchiveRestore aria-hidden />
              {t('inventory.actions.restore')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent>
          {asking && (
            <>
              <AlertDialogTitle>{t(`inventory.${asking}.title`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {asking === 'finish'
                  ? unchecked > 0
                    ? t('inventory.finish.hint', { count: unchecked })
                    : t('inventory.finish.hintNone')
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
