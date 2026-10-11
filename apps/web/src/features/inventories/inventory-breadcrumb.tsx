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
 * The inventory screen a location of the path leads to: the run's root is the run itself (its
 * overview), any other location its checklist. A location the run has no screen for has no crumb.
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

/**
 * The way up on a run's screens, inventory screens only: the Inventura tab, the run's root (its
 * overview), then the locations on the way down to the page's own that have a checklist in the
 * run, the last one in bold. A location above the root, or a floor with no items of its own, is
 * left out: its only screen would be the ordinary location detail. Every crumb is a link.
 * `path` is the page's location from the top of the tree, itself last.
 */
export function InventoryBreadcrumb({ inventory, path }: { inventory: InventoryDto; path: CodeRef[] }) {
  const { t } = useTranslation();
  const hasScreen = new Set([inventory.location.id, ...inventory.locations.map((location) => location.id)]);
  const crumbs = path.filter((segment, index) => index === path.length - 1 || hasScreen.has(segment.id));
  return (
    <nav aria-label={t('inventory.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-foreground/80">
        <li>
          <Link to="/" search={{ tab: 'inventory' }} activeOptions={exactPage} className={crumbLink}>
            {t('home.inventory.tab')}
          </Link>
        </li>
        {crumbs.map((segment, index) => (
          <li key={segment.id} className="flex items-center gap-x-1">
            <ChevronRight aria-hidden className="size-3.5" />
            <CrumbLink inventory={inventory} segment={segment} current={index === crumbs.length - 1} />
          </li>
        ))}
      </ol>
    </nav>
  );
}
