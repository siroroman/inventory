import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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

type Props = {
  archived: boolean;
  archive: () => Promise<unknown>;
  restore: () => Promise<unknown>;
  /** What archiving does, shown in the confirm dialog. */
  title: string;
  description: ReactNode;
};

/**
 * The Archive button of a detail screen, which asks first, or Restore once the record is archived
 * (restoring loses nothing, so it does not ask). Whoever renders it decides who may see it.
 * A failure (a stale version, say) is toasted by the query client.
 */
export function ArchiveControl({ archived, archive, restore, title, description }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

  const change = useMutation({
    mutationFn: () => (archived ? restore() : archive()),
    // The answer is not cached as the detail (an item's has no photos): everything cached is stale,
    // and the open detail is fetched again.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
      toast.success(t('common.saved'));
    },
  });

  if (archived) {
    return (
      <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate()}>
        <ArchiveRestore aria-hidden />
        {t('common.restore')}
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => setAsking(true)}>
        <Archive aria-hidden />
        {t('common.archive')}
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">{description}</div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => change.mutate()}>{t('common.archive')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
