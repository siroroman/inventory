import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { InventoryScanner } from '@/features/inventories/inventory-scanner';

// The location whose checklist the scanner was opened from; anything that is no id is ignored and
// the scanner works on the run as a whole.
const searchSchema = z.object({ locationId: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute('/_app/inventories/$id/scan')({
  validateSearch: searchSchema,
  component: InventoryScanPage,
});

function InventoryScanPage() {
  const { id } = Route.useParams();
  const { locationId } = Route.useSearch();
  return <InventoryScanner key={`${id}/${locationId ?? ''}`} id={id} locationId={locationId} />;
}
