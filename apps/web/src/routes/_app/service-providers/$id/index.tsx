import { createFileRoute } from '@tanstack/react-router';
import { ServiceProviderDetail } from '@/features/service-providers/provider-detail';

export const Route = createFileRoute('/_app/service-providers/$id/')({ component: ServiceProviderDetailPage });

function ServiceProviderDetailPage() {
  const { id } = Route.useParams();
  return <ServiceProviderDetail key={id} id={id} />;
}
