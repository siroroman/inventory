import type { CodeRef, InventoryDto } from '@inventory/shared';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** A link in the breadcrumb: at least 44 px tall to tap. */
const crumbLink =
  'inline-flex min-h-11 items-center rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring';

/** Only the exact page counts as active, whatever the search text (`?q=` of a checklist). */
const exactPage = { exact: true, includeSearch: false } as const;

/**
 * Where a location of the path leads. The run's root is the run itself (its overview); a location
 * the run has a checklist for opens that checklist; the others (above the root, or a floor with no
 * items of its own) have no screen in the run, so they open their ordinary detail.
 */
function CrumbLink({ inventory, segment, current }: { inventory: InventoryDto; segment: CodeRef; current: boolean }) {
  const className = cn(crumbLink, current && 'font-bold text-foreground');
  if (segment.id === inventory.location.id) {
    return (
      <Link to="/inventories/$id" params={{ id: inventory.id }} activeOptions={exactPage} className={className}>
        {segment.name}
      </Link>
    );
  }
  if (inventory.locations.some((location) => location.id === segment.id)) {
    return (
      <Link
        to="/inventories/$id/locations/$locationId"
        params={{ id: inventory.id, locationId: segment.id }}
        activeOptions={exactPage}
        className={className}
      >
        {segment.name}
      </Link>
    );
  }
  return (
    <Link to="/locations/$id" params={{ id: segment.id }} activeOptions={exactPage} className={className}>
      {segment.name}
    </Link>
  );
}

/**
 * The way up on a run's screens: the Inventura tab, then every location of `path` (top level down
 * to the page's own location, the last one, in bold). Every crumb is a link.
 */
export function InventoryBreadcrumb({ inventory, path }: { inventory: InventoryDto; path: CodeRef[] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('inventory.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-foreground/80">
        <li>
          <Link to="/" search={{ tab: 'inventory' }} activeOptions={exactPage} className={crumbLink}>
            {t('home.inventory.tab')}
          </Link>
        </li>
        {path.map((segment, index) => (
          <li key={segment.id} className="flex items-center gap-x-1">
            <ChevronRight aria-hidden className="size-3.5" />
            <CrumbLink inventory={inventory} segment={segment} current={index === path.length - 1} />
          </li>
        ))}
      </ol>
    </nav>
  );
}
