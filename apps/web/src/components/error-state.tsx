import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

type Props = {
  /** Defaults to "Něco se nepovedlo". */
  title?: string;
  message?: string;
  /** Shows a "Zkusit znovu" button. */
  onRetry?: () => void;
  children?: ReactNode;
};

/** A screen or section that failed to load: what happened and, when possible, how to retry. */
export function ErrorState({ title, message, onRetry, children }: Props) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      <CircleAlert aria-hidden className="size-8 text-muted-foreground" />
      <p className="text-[15px] font-semibold">{title ?? t('states.errorTitle')}</p>
      {message && <p className="max-w-sm text-sm text-muted-foreground">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          {t('common.retry')}
        </Button>
      )}
      {children}
    </div>
  );
}
