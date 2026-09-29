import { createFileRoute } from '@tanstack/react-router';
import { ItemDetail } from '@/features/items/item-detail';

export const Route = createFileRoute('/_app/items/$id')({ component: ItemDetailPage });

function ItemDetailPage() {
  const { id } = Route.useParams();
  return <ItemDetail id={id} />;
}
