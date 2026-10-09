import type { InventoryRowDto, InventoryRowsDto } from '@inventory/shared';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { problemMessage } from '@/lib/problem';
import { checkInventoryItem, inventoryItemsQueryKey, uncheckInventoryItem } from './api';

type Tick = { row: InventoryRowDto; checked: boolean };

/** The rows with the server's answer for one of them; an item found elsewhere or added drops out once unticked. */
function withAnswer(rows: InventoryRowsDto, answer: InventoryRowDto): InventoryRowsDto {
  const others = rows.items.filter((row) => row.id !== answer.id);
  return { items: answer.kind === 'expected' || answer.checkedAt ? [...others, answer] : others };
}

/**
 * Ticking and unticking the rows of one location. A tick shows at once as pending (`pending` maps
 * the item to the state it is going to), but the row only moves to its group when the server has
 * confirmed it, so the screen never shows a check that was not saved. A failure puts the box back
 * and says so.
 */
export function useTickItem(inventoryId: string, locationId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const inFlight = useRef(0);
  const key = inventoryItemsQueryKey(inventoryId, locationId);

  const tick: UseMutationResult<InventoryRowDto, Error, Tick> = useMutation({
    mutationFn: ({ row, checked }: Tick) => (checked ? checkInventoryItem : uncheckInventoryItem)(inventoryId, row.id),
    meta: { silentError: true },
    onMutate: async ({ row, checked }) => {
      inFlight.current += 1;
      setPending((previous) => new Map(previous).set(row.id, checked));
      // A refresh that started before this tick would bring the old state back.
      await queryClient.cancelQueries({ queryKey: key });
    },
    onSuccess: (answer, { row, checked }) => {
      queryClient.setQueryData<InventoryRowsDto>(key, (rows) => rows && withAnswer(rows, answer));
      if (!checked) {
        toast(t('inventory.checklist.uncheckedToast', { name: row.name }), {
          action: { label: t('inventory.checklist.undo'), onClick: () => tick.mutate({ row, checked: true }) },
        });
      }
    },
    onError: (error) => toast.error(t('inventory.checklist.notSaved'), { description: problemMessage(error) }),
    onSettled: (_answer, _error, { row }) => {
      inFlight.current -= 1;
      setPending((previous) => {
        const next = new Map(previous);
        next.delete(row.id);
        return next;
      });
      // Once the last tick is through (also after a failure), show what the server has: the counts changed, or the run closed.
      if (inFlight.current === 0) void queryClient.invalidateQueries({ queryKey: ['inventories'] });
    },
  });

  return { pending, tick: (row: InventoryRowDto, checked: boolean) => tick.mutate({ row, checked }) };
}
