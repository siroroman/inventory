import { Link, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { problemMessage } from '@/lib/problem';

/** Router-wide fallback when a route throws while loading or rendering. */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  return (
    <ErrorState
      message={problemMessage(error)}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

/** Router-wide fallback for a URL that matches no route. */
export function RouteNotFound() {
  const { t } = useTranslation();
  return (
    <ErrorState title={t('states.notFoundTitle')} message={t('states.notFoundHint')}>
      <Button asChild variant="outline" size="sm" className="mt-1">
        <Link to="/">{t('states.backHome')}</Link>
      </Button>
    </ErrorState>
  );
}
