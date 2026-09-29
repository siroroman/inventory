import { Badge } from '@/components/ui/badge';
import { serviceStatus } from '@/lib/service-status';

/** "Overdue" (red) or "due within 30 days" (amber) for a next-service date, or nothing. */
export function ServiceBadge({
  nextServiceOn,
  labels,
}: {
  nextServiceOn: string | null;
  labels: { overdue: string; soon: string };
}) {
  const status = serviceStatus(nextServiceOn);
  if (!status) return null;
  return <Badge variant={status === 'overdue' ? 'danger' : 'warning'}>{labels[status]}</Badge>;
}
