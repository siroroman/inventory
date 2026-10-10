import type { InventoryRowDto, InventoryRowsDto } from '@inventory/shared';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { problemMessage } from '@/lib/problem';
import {
  checkInventoryItem,
  inventoryItemsQueryKey,
  markInventoryItemMissing,
  uncheckInventoryItem,
  unmarkInventoryItemMissing,
} from './api';

/** What a person can do to a row: tick it, untick it, flag it as missing, take the flag back. */
export type RowAction = 'check' | 'uncheck' | 'flag' | 'unflag';
type Change = { row: InventoryRowDto; action: RowAction };

const request = {
  check: checkInventoryItem,
  uncheck: uncheckInventoryItem,
  flag: markInventoryItemMissing,
  unflag: unmarkInventoryItemMissing,
};

/** The state of the checkbox a change on its way will leave (a flag does not touch it); undefined when none is on its way. */
export const pendingChecked = (action: RowAction | undefined): boolean | undefined =>
  action === 'check' ? true : action === 'uncheck' ? false : undefined;

/** The rows with the server's answer for one of them; an item found elsewhere or added drops out once unticked. */
function withAnswer(rows: InventoryRowsDto, answer: InventoryRowDto): InventoryRowsDto {
  const others = rows.items.filter((row) => row.id !== answer.id);
  return { items: answer.kind === 'expected' || answer.checkedAt ? [...others, answer] : others };
}

/**
 * Ticking, unticking and flagging the rows of one location. A change shows at once as pending
 * (`pending` maps the item to what is on its way), but the row only moves to its group when the
 * server has confirmed it, so the screen never shows a check or a flag that was not saved. A
 * failure puts the row back and says so.
 */
export function useTickItem(inventoryId: string, locationId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlyMap<string, RowAction>>(new Map());
  const inFlight = useRef(0);
  const key = inventoryItemsQueryKey(inventoryId, locationId);

  const change: UseMutationResult<InventoryRowDto, Error, Change> = useMutation({
    mutationFn: ({ row, action }: Change) => request[action](inventoryId, row.id),
    meta: { silentError: true },
    onMutate: async ({ row, action }) => {
      inFlight.current += 1;
      setPending((previous) => new Map(previous).set(row.id, action));
      // A refresh that started before this change would bring the old state back.
      await queryClient.cancelQueries({ queryKey: key });
    },
    onSuccess: (answer, { row, action }) => {
      queryClient.setQueryData<InventoryRowsDto>(key, (rows) => rows && withAnswer(rows, answer));
      if (action === 'uncheck') {
        toast(t('inventory.checklist.uncheckedToast', { name: row.name }), {
          action: { label: t('inventory.checklist.undo'), onClick: () => change.mutate({ row, action: 'check' }) },
        });
      } else if (action === 'flag' && answer.missing) {
        // Not when somebody checked the item first: then it is found, and the row says so.
        toast(t('inventory.checklist.flaggedToast', { name: row.name }), {
          action: { label: t('inventory.checklist.undo'), onClick: () => change.mutate({ row, action: 'unflag' }) },
        });
      }
    },
    onError: (error, { action }) =>
      toast.error(t(action === 'flag' || action === 'unflag' ? 'inventory.checklist.flagNotSaved' : 'inventory.checklist.notSaved'), {
        description: problemMessage(error),
      }),
    onSettled: (_answer, _error, { row }) => {
      inFlight.current -= 1;
      setPending((previous) => {
        const next = new Map(previous);
        next.delete(row.id);
        return next;
      });
      // Once the last change is through (also after a failure), show what the server has: the counts changed, or the run closed.
      if (inFlight.current === 0) void queryClient.invalidateQueries({ queryKey: ['inventories'] });
    },
  });

  return {
    pending,
    tick: (row: InventoryRowDto, checked: boolean) => change.mutate({ row, action: checked ? 'check' : 'uncheck' }),
    flag: (row: InventoryRowDto, missing: boolean) => change.mutate({ row, action: missing ? 'flag' : 'unflag' }),
  };
}
