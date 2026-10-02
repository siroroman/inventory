import { createFileRoute } from '@tanstack/react-router';
import { ServiceRecordEdit } from '@/features/service-records/service-record-edit';

export const Route = createFileRoute('/_app/service-records/$id/edit')({ component: EditServiceRecordPage });

function EditServiceRecordPage() {
  const { id } = Route.useParams();
  return <ServiceRecordEdit key={id} id={id} />;
}
