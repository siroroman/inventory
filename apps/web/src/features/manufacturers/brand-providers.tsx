import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { sectionTitleClass } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { problemMessage } from '@/lib/problem';
import { manufacturerQueryOptions } from './api';
import { RankedProviders } from './ranked-providers';

/**
 * Who to call for an item of this brand: the brand's service providers in contact order, read only
 * (the order is changed on the brand's own screen). Shown on the item detail.
 */
export function BrandProviders({ manufacturerId }: { manufacturerId: string }) {
  const { t } = useTranslation();
  const query = useQuery(manufacturerQueryOptions(manufacturerId));

  let body: ReactNode;
  if (query.data) {
    body =
      query.data.providers.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{t('manufacturer.providers.empty')}</p>
      ) : (
        <RankedProviders providers={query.data.providers} />
      );
  } else if (query.isError) {
    body = (
      <p role="alert" className="text-sm text-destructive">
        {problemMessage(query.error)}{' '}
        <Button type="button" variant="link" className="inline h-auto p-0 text-sm" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </p>
    );
  } else {
    body = <Skeleton role="status" aria-label={t('states.loading')} className="h-24 w-full" />;
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className={sectionTitleClass}>{t('manufacturer.providers.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('manufacturer.providers.hint')}</p>
      </div>
      {body}
    </div>
  );
}
