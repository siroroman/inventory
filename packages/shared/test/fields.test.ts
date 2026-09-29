import { describe, expect, it } from 'vitest';
import { documentsUrl, hasChange, isoDate, nullableText, pageOf, requiredText, searchQuery, timestamp, versionBody } from '../src/index.ts';

describe('text fields', () => {
  it('trims and rejects whitespace-only or too long input', () => {
    expect(requiredText(10).parse('  Vrták ')).toBe('Vrták');
    expect(requiredText(10).safeParse('   ').success).toBe(false);
    expect(requiredText(3).safeParse('abcd').success).toBe(false);
  });

  it('clears with null but not with an empty string', () => {
    expect(nullableText(10).parse(null)).toBeNull();
    expect(nullableText(10).safeParse('').success).toBe(false);
  });

  it('limits a search query to 100 characters', () => {
    expect(searchQuery.safeParse('a'.repeat(100)).success).toBe(true);
    expect(searchQuery.safeParse('a'.repeat(101)).success).toBe(false);
  });

  it('treats blank input as no search and trims the rest', () => {
    expect(searchQuery.parse('   ')).toBeUndefined();
    expect(searchQuery.parse('')).toBeUndefined();
    expect(searchQuery.parse('  kuchyně ')).toBe('kuchyně');
  });
});

describe('dates', () => {
  it('accepts a calendar date and rejects other shapes', () => {
    expect(isoDate.safeParse('2026-09-27').success).toBe(true);
    expect(isoDate.safeParse('2026-13-01').success).toBe(false);
    expect(isoDate.safeParse('27. 9. 2026').success).toBe(false);
  });

  it('accepts a UTC timestamp', () => {
    expect(timestamp.safeParse(new Date().toISOString()).success).toBe(true);
    expect(timestamp.safeParse('2026-09-27').success).toBe(false);
  });
});

describe('documentsUrl', () => {
  it.each([
    'https://drive.google.com/drive/folders/abc',
    'https://docs.google.com/document/d/abc/edit',
  ])('accepts %s', (url) => {
    expect(documentsUrl.safeParse(url).success).toBe(true);
  });

  it.each([
    'http://drive.google.com/x',
    'https://evil.example/drive.google.com',
    'https://drive.google.com.evil.example/x',
    'https://google.com/x',
    'javascript:alert(1)',
    'drive.google.com/x',
  ])('rejects %s', (url) => {
    expect(documentsUrl.safeParse(url).success).toBe(false);
  });
});

describe('pageOf', () => {
  const schema = pageOf(requiredText(10));

  it('wraps items with the cursor and total', () => {
    expect(schema.parse({ items: ['a'], nextCursor: null, total: 1 })).toEqual({ items: ['a'], nextCursor: null, total: 1 });
  });

  it('requires a total', () => {
    expect(schema.safeParse({ items: [], nextCursor: null }).success).toBe(false);
  });
});

describe('versionBody', () => {
  it('needs a positive integer version and nothing else', () => {
    expect(versionBody.safeParse({ version: 3 }).success).toBe(true);
    expect(versionBody.safeParse({ version: 0 }).success).toBe(false);
    expect(versionBody.safeParse({ version: 1, extra: true }).success).toBe(false);
  });
});

describe('hasChange', () => {
  it('needs at least one field besides the version', () => {
    expect(hasChange({ version: 1 })).toBe(false);
    expect(hasChange({ version: 1, name: undefined })).toBe(false);
    expect(hasChange({ version: 1, note: null })).toBe(true);
  });
});
