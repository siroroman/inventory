import { createFileRoute } from '@tanstack/react-router';
import { EditServiceProvider } from '@/features/service-providers/provider-form-screen';

export const Route = createFileRoute('/_app/service-providers/$id/edit')({ component: EditServiceProviderPage });

function EditServiceProviderPage() {
  const { id } = Route.useParams();
  return <EditServiceProvider key={id} id={id} />;
}
