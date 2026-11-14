// How the accounting (účetní evidence) numbers are kept on an item now that items are numbered
// INV-0001, INV-0002... and the code carries neither the centre nor the accounting number.

/** The external ID source of the accounting inventory number: `<centre>-<number>`, 73-2023016. */
export const ACCOUNTING_SOURCE = 'Účetnictví';
/** The external ID source of the item's code before the items were renumbered. */
export const ORIGINAL_CODE_SOURCE = 'Původní kód';

/**
 * Sources whose value may be on several items. The accountant keeps several pieces under one
 * inventory number (8 fridges as `69-1134`), and each piece is an item of its own, so they share
 * the number. Every other source still identifies one item. Mirrored, case ignored, by the partial
 * unique index `item_external_ids_source_value_key` (schema/items.ts); keep the two in step.
 */
export const SHARED_SOURCES = [ACCOUNTING_SOURCE] as const;

/** Whether a value of this source may be on several items (case ignored, like the index). */
export const isSharedSource = (source: string) =>
  SHARED_SOURCES.some((shared) => shared.toLowerCase() === source.toLowerCase());

/**
 * The external ID of an accounting inventory number. Accounting restarts its numbers in every
 * centre, so the centre belongs in it; the number alone would repeat.
 */
export const accountingId = (centre: string, inventoryNumber: string) => `${centre}-${inventoryNumber}`;
