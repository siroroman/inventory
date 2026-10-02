import type { ItemDetailDto, PhotoDto } from '@inventory/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, ExternalLink, Pencil } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveControl } from '@/components/archive-control';
import { ArchivedBadge } from '@/components/archived-badge';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanWrite } from '@/features/auth/use-can-write';
import { ServiceHistory } from '@/features/service-records/service-history';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { problemMessage } from '@/lib/problem';
import { warrantyExpired } from '@/lib/service-status';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { archiveItem, itemDetailQueryOptions, restoreItem } from './api';
import { ServiceBadge } from './service-badge';

// Tailwind's `md` breakpoint.
const wideScreen = '(min-width: 768px)';

function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-6 w-56 max-w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="h-4 w-64 max-w-full" />
    </div>
  );
}

/** A labelled group of fields. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Label and value pairs; an empty value shows as "—". */
function Fields({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(({ label, value }) => (
        <div key={label}>
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-[15px] break-words">
            {value === null || value === undefined || value === '' ? t('item.empty') : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A phone scrolls through the photos side by side; a wide screen shows one large with thumbnails. */
function Gallery({ name, photos }: { name: string; photos: PhotoDto[] }) {
  const { t } = useTranslation();
  const wide = useMediaQuery(wideScreen);
  const [selected, setSelected] = useState(0);
  const alt = (index: number) => t('item.photoAlt', { name, n: index + 1, total: photos.length });

  if (photos.length === 0) return null;

  if (!wide) {
    return (
      <ul
        aria-label={t('item.photosLabel')}
        className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4"
      >
        {photos.map((photo, index) => (
          <li key={photo.id} className="shrink-0 snap-center">
            <img
              src={photo.url}
              alt={alt(index)}
              width={photo.width}
              height={photo.height}
              className="h-56 w-auto max-w-[85vw] rounded-lg border bg-muted object-cover"
            />
          </li>
        ))}
      </ul>
    );
  }

  const current = Math.min(selected, photos.length - 1);
  const main = photos[current]!;
  return (
    <div className="flex gap-3">
      <img
        src={main.url}
        alt={alt(current)}
        width={main.width}
        height={main.height}
        className="max-h-96 min-w-0 flex-1 rounded-lg border bg-muted object-contain"
      />
      {photos.length > 1 && (
        <ul aria-label={t('item.photosLabel')} className="flex w-20 shrink-0 flex-col gap-2">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                aria-label={t('item.showPhoto', { n: index + 1 })}
                aria-current={index === current}
                onClick={() => setSelected(index)}
                className={cn(
                  'block size-20 overflow-hidden rounded-md border-2 border-transparent focus-visible:outline-2 focus-visible:outline-ring',
                  index === current && 'border-primary',
                )}
              >
                <img src={photo.url} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A link in the breadcrumb: at least 44 px tall to tap. */
const crumbLink =
  'inline-flex min-h-11 items-center rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring';

/** The way up: the Locations tab, every level of the location, then the item itself as the current page. */
function Breadcrumb({ item }: { item: ItemDetailDto }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('item.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        <li>
          <Link to="/" className={crumbLink}>
            {t('home.locations.tab')}
          </Link>
        </li>
        {item.path.map((segment) => (
          <li key={segment.id} className="flex items-center gap-x-1">
            <ChevronRight aria-hidden className="size-3.5" />
            <Link to="/locations/$id" params={{ id: segment.id }} className={crumbLink}>
              {segment.name}
            </Link>
          </li>
        ))}
        <li className="flex items-center gap-x-1">
          <ChevronRight aria-hidden className="size-3.5" />
          <span aria-current="page" className="text-foreground">
            {item.name}
          </span>
        </li>
      </ol>
    </nav>
  );
}

function ItemBody({ item }: { item: ItemDetailDto }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const date = (value: string | null) => (value ? formatDate(value) : null);

  return (
    <>
      <div>
        <Breadcrumb item={item} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">{item.name}</h1>
          {item.archivedAt && <ArchivedBadge />}
          {canWrite && (
            <div className="ml-auto flex items-center gap-2">
              {!item.archivedAt && (
                <Button asChild size="sm">
                  <Link to="/items/$id/edit" params={{ id: item.id }}>
                    <Pencil aria-hidden />
                    {t('item.edit')}
                  </Link>
                </Button>
              )}
              <ArchiveControl
                archived={Boolean(item.archivedAt)}
                archive={() => archiveItem(item.id, item.version)}
                restore={() => restoreItem(item.id, item.version)}
                title={t('item.archiveTitle')}
                description={<p>{t('item.archiveHint')}</p>}
              />
            </div>
          )}
        </div>
      </div>

      <Gallery key={item.id} name={item.name} photos={item.photos} />

      <Section title={t('item.sections.basic')}>
        <Fields
          rows={[
            { label: t('item.fields.code'), value: item.code },
            {
              label: t('item.fields.externalIds'),
              value:
                item.externalIds.length > 0 ? (
                  <ul>
                    {item.externalIds.map(({ source, value }) => (
                      <li key={`${source}:${value}`}>
                        {source}: {value}
                      </li>
                    ))}
                  </ul>
                ) : null,
            },
            { label: t('item.fields.manufacturer'), value: item.manufacturer?.name },
            { label: t('item.fields.model'), value: item.model },
            { label: t('item.fields.serialNumber'), value: item.serialNumber },
            { label: t('item.fields.manufactureYear'), value: item.manufactureYear },
          ]}
        />
      </Section>

      <Section title={t('item.sections.warranty')}>
        <Fields
          rows={[
            { label: t('item.fields.registeredOn'), value: date(item.registeredOn) },
            {
              label: t('item.fields.warrantyUntil'),
              value: item.warrantyUntil && (
                <span className="flex flex-wrap items-center gap-2">
                  {formatDate(item.warrantyUntil)}
                  {warrantyExpired(item.warrantyUntil) && (
                    <Badge variant="danger">{t('item.warrantyExpired')}</Badge>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Section>

      {item.documentsUrl && (
        <Section title={t('item.sections.documents')}>
          <Button asChild variant="outline">
            <a href={item.documentsUrl} target="_blank" rel="noopener noreferrer">
              {t('item.openDocuments')}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </Section>
      )}

      {item.note && (
        <Section title={t('item.sections.note')}>
          <p className="text-[15px] break-words whitespace-pre-line">{item.note}</p>
        </Section>
      )}

      <Section title={t('item.sections.service')}>
        <Fields
          rows={[
            { label: t('item.fields.lastServiceOn'), value: date(item.lastServiceOn) },
            {
              label: t('item.fields.nextServiceOn'),
              value: item.nextServiceOn && (
                <span className="flex flex-wrap items-center gap-2">
                  {formatDate(item.nextServiceOn)}
                  <ServiceBadge
                    nextServiceOn={item.nextServiceOn}
                    labels={{ overdue: t('item.service.overdue'), soon: t('item.service.soon') }}
                  />
                </span>
              ),
            },
          ]}
        />
        <ServiceHistory itemId={item.id} canAdd={canWrite && !item.archivedAt} />
      </Section>
    </>
  );
}

/** Item detail screen: photos, basic info, warranty, documents, note and, last, the service dates and history. */
export function ItemDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery(itemDetailQueryOptions(id));

  let body: ReactNode;
  if (query.data) {
    body = <ItemBody item={query.data} />;
  } else if (query.isError) {
    // A missing record (or an id that is no id at all) will not appear on a retry.
    const missing =
      query.error instanceof ApiError &&
      (query.error.code === 'not_found' || query.error.code === 'validation_error');
    body = missing ? (
      <ErrorState title={t('item.notFoundTitle')} message={t('item.notFoundHint')} />
    ) : (
      <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else {
    body = <DetailSkeleton />;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      {body}
    </div>
  );
}
