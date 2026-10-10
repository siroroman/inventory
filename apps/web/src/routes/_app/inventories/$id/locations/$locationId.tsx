import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';
import { InventoryChecklist } from '@/features/inventories/inventory-checklist';

// The search text is in the URL. The router parses a hand-typed `?q=123` as a number, so numbers are
// accepted and turned back into text; anything else that does not fit is ignored.
const searchSchema = z.object({
  q: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/inventories/$id/locations/$locationId')({
  validateSearch: searchSchema,
  component: InventoryChecklistPage,
});

function InventoryChecklistPage() {
  const { id, locationId } = Route.useParams();
  const { q = '' } = Route.useSearch();
  const navigate = Route.useNavigate();
  // `replace`: every pause in typing would otherwise add a history entry to walk back through.
  const search = useCallback(
    (text: string) => void navigate({ search: { q: text || undefined }, replace: true }),
    [navigate],
  );
  return <InventoryChecklist key={`${id}/${locationId}`} id={id} locationId={locationId} q={q} onSearch={search} />;
}
