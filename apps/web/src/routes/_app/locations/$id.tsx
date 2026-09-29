import { createFileRoute } from '@tanstack/react-router';
import { LocationDetail } from '@/features/locations/location-detail';

export const Route = createFileRoute('/_app/locations/$id')({ component: LocationDetailRoute });

function LocationDetailRoute() {
  const { id } = Route.useParams();
  // Keyed: another location must not inherit the previous one's list state (kept rows while loading).
  return <LocationDetail key={id} id={id} />;
}
