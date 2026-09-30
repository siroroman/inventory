import { createFileRoute } from '@tanstack/react-router';
import { EditLocation } from '@/features/locations/location-form-screen';

// `$id_` (not `$id`) keeps this a sibling of the detail route instead of a child rendered inside it.
export const Route = createFileRoute('/_app/locations/$id_/edit')({ component: EditLocationRoute });

function EditLocationRoute() {
  const { id } = Route.useParams();
  // Keyed: another location must not inherit the previous one's form.
  return <EditLocation key={id} id={id} />;
}
