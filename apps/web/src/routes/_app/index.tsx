import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ItemsPanel } from '@/features/items/item-list';
import { LocationsPanel } from '@/features/locations/location-list';

const tabs = ['locations', 'items'] as const;
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

  return (
    <div className="mx-auto w-full max-w-6xl">
      <h1 className="sr-only">{t('home.title')}</h1>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList aria-label={t('home.title')} className="px-4">
          <TabsTrigger value="locations">{t('home.locations.tab')}</TabsTrigger>
          <TabsTrigger value="items">{t('home.items.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="locations">
          <LocationsPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />
        </TabsContent>
        <TabsContent value="items">
          <ItemsPanel q={q} onSearch={search} archived={archived} onArchived={showArchived} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
