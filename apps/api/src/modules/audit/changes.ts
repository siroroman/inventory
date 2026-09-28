export type FieldChange = { from: unknown; to: unknown };

/** The audit change set of an update: only the fields whose value actually changed. */
export function changedFields<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (!Object.is(from, to)) changes[field] = { from, to };
  }
  return changes;
}

/** The audit change set of a create: the initial value of every non-empty field. */
export function initialFields<T extends object>(
  row: T,
  fields: readonly (keyof T & string)[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    const to = row[field] ?? null;
    if (to !== null) changes[field] = { from: null, to };
  }
  return changes;
}
