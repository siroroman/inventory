import { asc, desc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  afterName,
  beforeTimestamp,
  decodeDateCursor,
  decodeIdCursor,
  decodeNameCursor,
  decodeTimestampCursor,
  encodeCursor,
  InvalidCursorError,
  toPage,
} from '../../src/db/pagination.ts';
import { locations } from '../../src/db/schema/index.ts';
import { useTestDb } from '../helpers/db.ts';
import { insertLocation } from '../helpers/factories.ts';

const ID = '0b8f7a8e-2f4c-4d6e-9a1b-3c5d7e9f1a2b';

describe('cursors', () => {
  it('round-trip a name key', () => {
    expect(decodeNameCursor(encodeCursor({ name: 'Čistička', id: ID }))).toEqual({ name: 'Čistička', id: ID });
  });

  it('round-trip a date key', () => {
    expect(decodeDateCursor(encodeCursor({ on: '2026-04-15', id: ID }))).toEqual({ on: '2026-04-15', id: ID });
  });

  it.each([
    ['a date that does not exist', encodeCursor({ on: '2026-02-31', id: ID })],
    ['a month and day out of range', encodeCursor({ on: '2026-13-45', id: ID })],
    ['text instead of a date', encodeCursor({ on: "x'; drop table items", id: ID })],
    ['an id that is not a uuid', encodeCursor({ on: '2026-04-15', id: 'nope' })],
    ['garbage', '%%%'],
  ])('reject a date cursor with %s', (_, cursor) => {
    expect(() => decodeDateCursor(cursor)).toThrow(InvalidCursorError);
  });

  it('round-trip a timestamp key', () => {
    const key = { at: '2026-10-03T07:15:00.123Z', id: ID };
    expect(decodeTimestampCursor(encodeCursor(key))).toEqual(key);
  });

  it.each([
    ['a date without a time', encodeCursor({ at: '2026-10-03', id: ID })],
    ['microseconds', encodeCursor({ at: '2026-10-03T07:15:00.123456Z', id: ID })],
    ['a moment that does not exist', encodeCursor({ at: '2026-13-45T07:15:00.000Z', id: ID })],
    ['text instead of a moment', encodeCursor({ at: "x'; drop table items", id: ID })],
    ['an id that is not a uuid', encodeCursor({ at: '2026-10-03T07:15:00.123Z', id: 'nope' })],
    ['garbage', '%%%'],
  ])('reject a timestamp cursor with %s', (_, cursor) => {
    expect(() => decodeTimestampCursor(cursor)).toThrow(InvalidCursorError);
  });

  it('round-trip an id key', () => {
    expect(decodeIdCursor(encodeCursor({ id: 42 }))).toBe(42);
  });

  it.each([
    ['not base64 json', '%%%'],
    ['wrong shape', encodeCursor({ foo: 1 })],
    ['id that is not a uuid', encodeCursor({ name: 'A', id: "x'; drop table items" })],
    ['null', encodeCursor(null as unknown as object)],
  ])('reject a name cursor with %s', (_, cursor) => {
    expect(() => decodeNameCursor(cursor)).toThrow(InvalidCursorError);
  });

  it.each([encodeCursor({ id: 0 }), encodeCursor({ id: 1.5 }), encodeCursor({ id: '7' }), 'garbage'])(
    'reject id cursor %s',
    (cursor) => {
      expect(() => decodeIdCursor(cursor)).toThrow(InvalidCursorError);
    },
  );
});

describe('toPage', () => {
  const keyOf = (n: number) => ({ id: n });

  it('returns no cursor when everything fits', () => {
    expect(toPage([1, 2], 2, keyOf)).toEqual({ items: [1, 2], nextCursor: null });
  });

  it('drops the look-ahead row and points the cursor at the last returned row', () => {
    const page = toPage([1, 2, 3], 2, keyOf);
    expect(page.items).toEqual([1, 2]);
    expect(decodeIdCursor(page.nextCursor!)).toBe(2);
  });
});

describe('afterName', () => {
  const t = useTestDb();

  it('pages through names in Czech order without gaps or repeats', async () => {
    const names = ['Chodba', 'Cukrárna', 'Čistírna', 'Hala', 'Řeznictví', 'Rampa', 'Šatna', 'Žehlírna', 'Zahrada'];
    for (const name of names) await insertLocation(t().app, { name });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const rows = await t()
        .app.select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(afterName(locations.name, locations.id, cursor))
        .orderBy(asc(locations.name), asc(locations.id))
        .limit(3);
      const page = toPage(rows, 2, (r) => ({ name: r.name, id: r.id }));
      seen.push(...page.items.map((r) => r.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(['Cukrárna', 'Čistírna', 'Hala', 'Chodba', 'Rampa', 'Řeznictví', 'Šatna', 'Zahrada', 'Žehlírna']);
  });

  it('continues after duplicate names by id', async () => {
    for (let i = 0; i < 3; i++) await insertLocation(t().app, { name: 'Sklad' });
    const all = await t().app.select({ id: locations.id, name: locations.name }).from(locations).orderBy(asc(locations.name), asc(locations.id));
    const cursor = encodeCursor({ name: 'Sklad', id: all[0]!.id });
    const rest = await t()
      .app.select({ id: locations.id })
      .from(locations)
      .where(afterName(locations.name, locations.id, cursor))
      .orderBy(asc(locations.name), asc(locations.id));
    expect(rest.map((r) => r.id)).toEqual([all[1]!.id, all[2]!.id]);
  });
});

describe('beforeTimestamp', () => {
  const t = useTestDb();

  it('pages newest first without gaps or repeats, also through rows with the same moment', async () => {
    const moment = (seconds: number, ms = 0) => new Date(Date.UTC(2026, 9, 3, 7, 0, seconds, ms));
    // Three rows share a moment; the id breaks the tie.
    const moments = [moment(1), moment(2), moment(2), moment(2), moment(3, 456), moment(4)];
    for (const [i, createdAt] of moments.entries()) await insertLocation(t().app, { name: `L${i}`, createdAt });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const rows = await t()
        .app.select()
        .from(locations)
        .where(beforeTimestamp(locations.createdAt, locations.id, cursor))
        .orderBy(desc(locations.createdAt), desc(locations.id))
        .limit(3);
      const page = toPage(rows, 2, (r) => ({ at: r.createdAt.toISOString(), id: r.id }));
      seen.push(...page.items.map((r) => r.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen[0]).toBe('L5');
    expect(seen[1]).toBe('L4');
    expect(seen.at(-1)).toBe('L0');
  });
});
