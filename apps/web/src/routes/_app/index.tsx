import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { homeTabs } from '@/components/home-sections';
import { InventoryPanel } from '@/features/inventories/inventory-list';
import { ItemsPanel } from '@/features/items/item-list';
import { LabelsPanel } from '@/features/labels/labels-panel';
import { LocationsPanel } from '@/features/locations/location-list';
import { ServiceProvidersPanel } from '@/features/service-providers/provider-list';
import { ServiceRecordsPanel } from '@/features/service-records/service-record-list';

// The URL holds the active section (`tab`, missing = locations), the search text and whether the
// archived records are shown instead. The side menu (desktop) and the hamburger menu (phone) switch
// the section; both start another one without search text. The router parses a
// hand-typed `?q=123` as a number, so numbers are accepted and turned back into text; anything
// else that does not fit is ignored rather than failing the page.
const searchSchema = z.object({
  tab: z.enum(homeTabs).optional().catch(undefined),
  q: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .optional()
    .catch(undefined),
  archived: z.literal(true).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/')({ validateSearch: searchSchema, component: Home });

function Home() {
  const { t } = useTranslation();
  const { tab = 'locations', q = '', archived = false } = Route.useSearch();
  const navigate = Route.useNavigate();
  // `replace`: every pause in typing would otherwise add a history entry to walk back through.
  const search = useCallback(
    (text: string) => void navigate({ search: (prev) => ({ ...prev, q: text || undefined }), replace: true }),
    [navigate],
  );

  const showArchived = useCallback(
    (checked: boolean) =>
      void navigate({ search: (prev) => ({ ...prev, archived: checked || undefined }), replace: true }),
    [navigate],
  );

  const panels = {
    locations: <LocationsPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />,
    items: <ItemsPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />,
    maintenance: <ServiceRecordsPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />,
    suppliers: <ServiceProvidersPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />,
    inventory: <InventoryPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />,
    labels: <LabelsPanel />,
  };

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <h1 className="sr-only">{t('home.title')}</h1>
      {panels[tab]}
    </div>
  );
}
