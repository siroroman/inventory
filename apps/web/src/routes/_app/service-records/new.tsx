import { createFileRoute } from '@tanstack/react-router';
import { ServiceRecordCreate } from '@/features/service-records/service-record-edit';

// Beside `$id/`: a record added from the Maintenance tab, where the item is picked in the form.
export const Route = createFileRoute('/_app/service-records/new')({ component: ServiceRecordCreate });
