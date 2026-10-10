import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ItemCreate } from '@/features/items/item-edit';

// `?locationId=` starts the item in that location. `?inventoryId=` is the run whose checklist it was
// opened from: the item is added to it and the form returns there (with `locationId`, to that
// location's checklist). Anything that is not an id is ignored.
const searchSchema = z.object({
  locationId: z.uuid().optional().catch(undefined),
  inventoryId: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/items/new')({ validateSearch: searchSchema, component: NewItemPage });

function NewItemPage() {
  const { locationId, inventoryId } = Route.useSearch();
  return <ItemCreate key={`${locationId}:${inventoryId}`} locationId={locationId} inventoryId={inventoryId} />;
}
