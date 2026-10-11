// How the accounting (účetní evidence) numbers are kept on an item now that items are numbered
// INV-0001, INV-0002... and the code carries neither the centre nor the accounting number.

/** The external ID source of the accounting inventory number: `<centre>-<number>`, 73-2023016. */
export const ACCOUNTING_SOURCE = 'Účetnictví';
/** The external ID source of the item's code before the items were renumbered. */
export const ORIGINAL_CODE_SOURCE = 'Původní kód';

/**
 * The external ID of an accounting inventory number. Accounting restarts its numbers in every
 * centre, so the centre belongs in it; the number alone would repeat.
 */
export const accountingId = (centre: string, inventoryNumber: string) => `${centre}-${inventoryNumber}`;
