import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Stops the user leaving a form with unsaved changes: in-app navigation opens a dialog (a browser
 * `confirm` is not shown everywhere, and then blocks every way out), closing the tab gets the
 * browser's own prompt. `changed` is read when a navigation starts, so it may read refs.
 */
export function UnsavedChangesGuard({ changed }: { changed: () => boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker({ shouldBlockFn: changed, enableBeforeUnload: changed, withResolver: true });
  return (
    <AlertDialog open={blocker.status === 'blocked'}>
      <AlertDialogContent>
        <AlertDialogTitle>{t('form.discardTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('form.discardHint')}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>{t('form.stay')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed?.()}>{t('form.leave')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
