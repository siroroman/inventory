import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLabelFonts } from '../src/features/labels/fonts.ts';

afterEach(() => vi.unstubAllGlobals());

describe('loadLabelFonts', () => {
  it('fetches the regular and the bold file from the app and returns their bytes', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array([url.includes('Bold') ? 2 : 1]));
    });
    const fonts = await loadLabelFonts();
    expect(fetched.sort()).toEqual([expect.stringContaining('Roboto-Bold'), expect.stringContaining('Roboto-Regular')]);
    expect([...fonts.regular]).toEqual([1]);
    expect([...fonts.bold]).toEqual([2]);
  });

  it('fails when a font does not load, so no PDF with missing letters is made', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(loadLabelFonts()).rejects.toThrow(/did not load/);
  });
});
