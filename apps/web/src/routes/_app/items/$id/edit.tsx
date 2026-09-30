import { createFileRoute } from '@tanstack/react-router';
import { ItemEdit } from '@/features/items/item-edit';

export const Route = createFileRoute('/_app/items/$id/edit')({ component: EditItemPage });

function EditItemPage() {
  const { id } = Route.useParams();
  return <ItemEdit id={id} />;
}
