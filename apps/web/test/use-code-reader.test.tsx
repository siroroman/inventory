import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({
  status: 'running' as 'starting' | 'running' | 'denied',
  /** What the decoder sees on each look: the next value, or nothing once the script is used up. */
  script: [] as (string | null)[],
  loads: 0,
  /** How many loads of the decoder fail before one works. */
  failLoads: 0,
}));

vi.mock('../src/features/scanner/use-camera.ts', () => ({
  useCamera: () => ({
    videoRef: { current: { readyState: 4 } },
    status: control.status,
    torch: { supported: false, on: false, toggle: async () => {} },
    retry: () => {},
  }),
}));
vi.mock('../src/features/scanner/qr-decoder.ts', () => ({
  createQrDecoder: async () => {
    control.loads += 1;
    if (control.failLoads > 0) {
      control.failLoads -= 1;
      throw new Error('chunk failed to load');
    }
    return async () => (control.script.length > 0 ? control.script.shift()! : null);
  },
}));

import { type CodeReading, decodeIntervalMs, useCodeReader } from '../src/features/scanner/use-code-reader.ts';

function Reader({ paused = false, onCode }: { paused?: boolean; onCode: (reading: CodeReading) => boolean | undefined }) {
  useCodeReader({ paused, onCode });
  return null;
}

/** Lets `ticks` looks of the reader happen. */
const looks = (ticks: number) => act(() => vi.advanceTimersByTimeAsync(ticks * decodeIntervalMs));

describe('useCodeReader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    control.status = 'running';
    control.script = [];
    control.loads = 0;
    control.failLoads = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a label once while it stays in view, and again after it was gone for the whole window', async () => {
    const onCode = vi.fn();
    control.script = ['inv-00042', 'inv-00042', 'inv-00042'];
    render(<Reader onCode={onCode} />);
    await looks(5);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith({ text: 'inv-00042', code: 'INV-00042' });

    // Out of view for more than 3 seconds, then back.
    await act(() => vi.advanceTimersByTimeAsync(3500));
    control.script = ['inv-00042'];
    await looks(2);
    expect(onCode).toHaveBeenCalledTimes(2);
  });

  it('reports text that is not the form of an ID with no code, also once', async () => {
    const onCode = vi.fn();
    control.script = ['https://example.com/x', 'https://example.com/x'];
    render(<Reader onCode={onCode} />);
    await looks(4);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith({ text: 'https://example.com/x', code: null });
  });

  it('reports each of two different labels', async () => {
    const onCode = vi.fn();
    control.script = ['INV-1', 'INV-2', 'INV-1'];
    render(<Reader onCode={onCode} />);
    await looks(5);
    expect(onCode.mock.calls.map(([reading]) => reading.code)).toEqual(['INV-1', 'INV-2']);
  });

  it('reads nothing while paused, and a label in view then counts as new when it resumes', async () => {
    const onCode = vi.fn();
    control.script = ['INV-1'];
    const { rerender } = render(<Reader paused onCode={onCode} />);
    await looks(5);
    expect(onCode).not.toHaveBeenCalled();
    expect(control.script).toEqual(['INV-1']);

    rerender(<Reader paused={false} onCode={onCode} />);
    await looks(3);
    expect(onCode).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while the camera is not running', async () => {
    control.status = 'denied';
    control.script = ['INV-1'];
    const onCode = vi.fn();
    render(<Reader onCode={onCode} />);
    await looks(5);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('loads the decoder once and calls the latest handler', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Reader onCode={first} />);
    await looks(2);
    rerender(<Reader onCode={second} />);
    control.script = ['INV-9'];
    await looks(2);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(control.loads).toBe(1);
  });

  it('asks for the decoder again at the next look when it failed to load', async () => {
    const onCode = vi.fn();
    control.failLoads = 1;
    control.script = ['INV-1'];
    render(<Reader onCode={onCode} />);
    await looks(4);
    expect(control.loads).toBe(2);
    expect(onCode).toHaveBeenCalledOnce();
  });

  it('offers a label again at the next look when the handler could not take it', async () => {
    const onCode = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    control.script = ['INV-1', 'INV-1', 'INV-1'];
    render(<Reader onCode={onCode} />);
    await looks(5);
    // Declined once, taken once, then ignored while it stays in view.
    expect(onCode).toHaveBeenCalledTimes(2);
  });

  it('stops looking when the screen is left', async () => {
    const onCode = vi.fn();
    const { unmount } = render(<Reader onCode={onCode} />);
    await looks(2);
    unmount();
    control.script = ['INV-1'];
    await looks(5);
    expect(onCode).not.toHaveBeenCalled();
  });
});
