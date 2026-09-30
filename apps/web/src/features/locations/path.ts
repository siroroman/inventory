import type { CodeRef } from '@inventory/shared';

/** "Centrála Praha › Přízemí": a path of locations as one line of text. */
export function pathLabel(path: CodeRef[]): string {
  return path.map((segment) => segment.name).join(' › ');
}
