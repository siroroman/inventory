import { createFileRoute } from '@tanstack/react-router';
import { InventoryDetail } from '@/features/inventories/inventory-detail';

export const Route = createFileRoute('/_app/inventories/$id/')({ component: InventoryDetailPage });

function InventoryDetailPage() {
  const { id } = Route.useParams();
  return <InventoryDetail key={id} id={id} />;
}
