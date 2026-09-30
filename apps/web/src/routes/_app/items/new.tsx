import { createFileRoute } from '@tanstack/react-router';
import { ItemCreate } from '@/features/items/item-edit';

export const Route = createFileRoute('/_app/items/new')({ component: ItemCreate });
