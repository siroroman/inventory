import { createFileRoute } from '@tanstack/react-router';
import { ServiceRecordCreate } from '@/features/service-records/service-record-edit';

export const Route = createFileRoute('/_app/items/$id/service-records/new')({ component: NewServiceRecordPage });

function NewServiceRecordPage() {
  const { id } = Route.useParams();
  return <ServiceRecordCreate key={id} itemId={id} />;
}
