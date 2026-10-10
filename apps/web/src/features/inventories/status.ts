import type { InventoryStatus } from '@inventory/shared';

/** Badge variant of a run's status, shared by the Inventura tab and the run overview. */
export const statusBadge = { in_progress: 'info', finished: 'success', cancelled: 'neutral' } as const satisfies Record<
  InventoryStatus,
  string
>;
