import { useCanGoBack, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * "Zpět" above the title of a detail screen: the screen the user came from. On a deep link there is
 * nothing to go back to, so it leads to `fallback`, a link built around the button's content.
 */
export function BackButton({ fallback }: { fallback: (content: ReactNode) => ReactElement }) {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const content = (
    <>
      <ArrowLeft aria-hidden />
      <span className="truncate">{t('common.back')}</span>
    </>
  );
  return (
    <Button
      asChild={!canGoBack}
      variant="link"
      className="-mb-3 min-h-11 max-w-full min-w-0 self-start px-0 text-foreground"
      onClick={canGoBack ? () => router.history.back() : undefined}
    >
      {canGoBack ? content : fallback(content)}
    </Button>
  );
}
