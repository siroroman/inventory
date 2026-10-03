import { createFileRoute } from '@tanstack/react-router';
import { ManufacturerDetail } from '@/features/manufacturers/manufacturer-detail';

export const Route = createFileRoute('/_app/manufacturers/$id')({ component: ManufacturerDetailPage });

function ManufacturerDetailPage() {
  const { id } = Route.useParams();
  return <ManufacturerDetail key={id} id={id} />;
}
