import { describe, expect, it } from 'vitest';
import { safeRedirect } from '../src/features/auth/redirect.ts';

describe('safeRedirect', () => {
  it('keeps a path on this site, with its query and hash', () => {
    expect(safeRedirect('/')).toBe('/');
    expect(safeRedirect('/locations/LOC-004')).toBe('/locations/LOC-004');
    expect(safeRedirect('/items?q=vrtacka&tab=items#top')).toBe('/items?q=vrtacka&tab=items#top');
  });

  it('leads home when there is nothing usable', () => {
    expect(safeRedirect(undefined)).toBe('/');
    expect(safeRedirect('')).toBe('/');
    expect(safeRedirect('items')).toBe('/');
  });

  it('refuses other sites, however they are spelled', () => {
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('/\\evil.example')).toBe('/');
    expect(safeRedirect('/\t/evil.example')).toBe('/');
    expect(safeRedirect('/\n/evil.example')).toBe('/');
    expect(safeRedirect('javascript:alert(1)')).toBe('/');
  });

  it('never returns to the login page', () => {
    expect(safeRedirect('/login')).toBe('/');
    expect(safeRedirect('/login?redirect=%2Fitems')).toBe('/');
    expect(safeRedirect('/loginx')).toBe('/loginx');
  });
});
