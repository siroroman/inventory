import { createFileRoute } from '@tanstack/react-router';
import { NewInventory } from '@/features/inventories/inventory-start';

export const Route = createFileRoute('/_app/inventories/new')({ component: NewInventory });
