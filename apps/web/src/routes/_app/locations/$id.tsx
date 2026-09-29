import { createFileRoute } from '@tanstack/react-router';
import { LocationDetail } from '@/features/locations/location-detail';

export const Route = createFileRoute('/_app/locations/$id')({ component: LocationDetailRoute });

function LocationDetailRoute() {
  const { id } = Route.useParams();
  return <LocationDetail id={id} />;
}
