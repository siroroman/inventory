import { humanCode } from '@inventory/shared';

/** How long a code is ignored after it was last read (SPEC §9.4.5: the same code within 3 seconds). */
export const repeatWindowMs = 3000;

/**
 * The text of a label as an item ID (trimmed, upper-cased), or null when it does not have the form
 * of one: a foreign QR code, which never reaches the API.
 */
export function asItemCode(text: string): string | null {
  const parsed = humanCode.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/**
 * Decides which readings of the camera are worth acting on. The camera reads a label many times a
 * second, so a code is ignored for `repeatWindowMs` after it was last seen, and every reading
 * renews that: a label held in front of the camera is reported once, not again every 3 seconds.
 */
export function createScanGate(now: () => number = Date.now) {
  const lastSeen = new Map<string, number>();
  return {
    /** Whether this reading is new. */
    accept(code: string): boolean {
      const at = now();
      for (const [seen, when] of lastSeen) if (at - when >= repeatWindowMs) lastSeen.delete(seen);
      const known = lastSeen.has(code);
      lastSeen.set(code, at);
      return !known;
    },
    /** Forgets everything, so the next reading of any code counts again. */
    reset() {
      lastSeen.clear();
    },
  };
}
