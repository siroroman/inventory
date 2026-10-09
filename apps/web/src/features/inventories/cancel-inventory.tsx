import type { InventoryDto } from '@inventory/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Ellipsis } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { invalidateAfterWrite } from '@/lib/query';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';
import { cancelInventory } from './api';

/**
 * "Zrušit inventuru" of a run in progress: a button on desktop, the "Další možnosti" menu on a
 * phone, and in both cases a question first. Whoever renders it decides who may see it.
 * A failure (someone cancelled it meanwhile, a stale version) is toasted by the query client.
 */
export function CancelInventory({ inventory }: { inventory: InventoryDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const desktop = useMediaQuery(desktopScreen);
  const [asking, setAsking] = useState(false);

  const cancel = useMutation({
    mutationFn: () => cancelInventory(inventory.id, inventory.version),
    onSuccess: () => toast.success(t('inventory.cancel.done')),
    // Also after a failure the open screen should show the run that won, with its version.
    onSettled: () => invalidateAfterWrite(queryClient),
  });

  return (
    <>
      {desktop ? (
        <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => setAsking(true)}>
          <Ban aria-hidden />
          {t('inventory.actions.cancel')}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('inventory.actions.more')} disabled={cancel.isPending}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAsking(true)}>
              <Ban aria-hidden />
              {t('inventory.actions.cancel')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Outside the menu, which closes (and unmounts its items) when an item is chosen. */}
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
