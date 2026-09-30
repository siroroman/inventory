import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ItemCreate } from '@/features/items/item-edit';

// `?locationId=` starts the item in that location; anything that is not an id is ignored.
const searchSchema = z.object({ locationId: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute('/_app/items/new')({ validateSearch: searchSchema, component: NewItemPage });

function NewItemPage() {
  const { locationId } = Route.useSearch();
  return <ItemCreate key={locationId} locationId={locationId} />;
}
