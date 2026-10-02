import { createFileRoute } from '@tanstack/react-router';
import { ServiceRecordDetail } from '@/features/service-records/service-record-detail';

export const Route = createFileRoute('/_app/service-records/$id/')({ component: ServiceRecordDetailPage });

function ServiceRecordDetailPage() {
  const { id } = Route.useParams();
  return <ServiceRecordDetail id={id} />;
}
