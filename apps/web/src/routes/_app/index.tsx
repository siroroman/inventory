import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InventoryPanel } from '@/features/inventories/inventory-list';
import { ItemsPanel } from '@/features/items/item-list';
import { LocationsPanel } from '@/features/locations/location-list';
import { ServiceProvidersPanel } from '@/features/service-providers/provider-list';
import { ServiceRecordsPanel } from '@/features/service-records/service-record-list';
import { desktopScreen, useMediaQuery } from '@/lib/use-media-query';

const tabs = ['locations', 'items', 'maintenance', 'suppliers', 'inventory'] as const;
type Tab = (typeof tabs)[number];

// The URL holds the active tab (missing = locations), the search text and whether the archived
// records are shown instead. The router parses a
// hand-typed `?q=123` as a number, so numbers are accepted and turned back into text; anything
// else that does not fit is ignored rather than failing the page.
const searchSchema = z.object({
  tab: z.enum(tabs).optional().catch(undefined),
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
  // At desktop width the side menu (in `AppShell`) switches the list, so there are no tabs.
  const sideMenu = useMediaQuery(desktopScreen);
  // Five tabs do not fit a phone: the list scrolls sideways, and the active tab is kept in view.
  const tabList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Radix names a trigger `<list id>-trigger-<value>`.
    tabList.current?.querySelector(`[id$="-trigger-${tab}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  // Another tab starts with an empty search: what was typed for locations means little for items.
  const selectTab = (value: string) =>
    void navigate({ search: { tab: value === 'locations' ? undefined : (value as Tab) } });
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
    inventory: <InventoryPanel q={q} onSearch={search} />,
  };

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <h1 className="sr-only">{t('home.title')}</h1>
      {sideMenu ? (
        panels[tab]
      ) : (
        <Tabs value={tab} onValueChange={selectTab}>
          {/* Inset like the lists below, so the line and the underline start and end at their edges. */}
          <TabsList ref={tabList} aria-label={t('home.title')} className="mx-4 gap-6">
            <TabsTrigger value="locations" className="px-0">
              {t('home.locations.tab')}
            </TabsTrigger>
            <TabsTrigger value="items" className="px-0">
              {t('home.items.tab')}
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="px-0">
              {t('home.maintenance.tab')}
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="px-0">
              {t('home.suppliers.tab')}
            </TabsTrigger>
            <TabsTrigger value="inventory" className="px-0">
              {t('home.inventory.tab')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="locations">{panels.locations}</TabsContent>
          <TabsContent value="items">{panels.items}</TabsContent>
          <TabsContent value="maintenance">{panels.maintenance}</TabsContent>
          <TabsContent value="suppliers">{panels.suppliers}</TabsContent>
          <TabsContent value="inventory">{panels.inventory}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
