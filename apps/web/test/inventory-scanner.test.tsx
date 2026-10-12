import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoCloseMs } from '../src/features/inventories/scan-sheet.tsx';
import { asItemCode } from '../src/features/scanner/scan-gate.ts';
import { formatTime } from '../src/lib/format.ts';
import { inventory, inventoryLocation, inventoryRow, person, ref } from './fixtures.ts';
import { jsonResponse, me, renderApp, stubApi } from './helpers.tsx';

// The camera and the decoder are the browser's: the screen is tested with a reader that the test drives.
const reader = vi.hoisted(() => ({
  status: 'running' as 'starting' | 'running' | 'denied' | 'unavailable' | 'error',
  torchSupported: false,
  torchOn: false,
  toggle: vi.fn(),
  retry: vi.fn(),
  paused: false,
  onCode: null as null | ((reading: { text: string; code: string | null }) => void),
}));

vi.mock('../src/features/scanner/use-code-reader.ts', () => ({
  useCodeReader: ({
    paused,
    onCode,
  }: {
    paused: boolean;
    onCode: (reading: { text: string; code: string | null }) => void;
  }) => {
    reader.paused = paused;
    reader.onCode = onCode;
    return {
      videoRef: { current: null },
      status: reader.status,
      torch: { supported: reader.torchSupported, on: reader.torchOn, toggle: reader.toggle },
      retry: reader.retry,
    };
  },
}));

const runId = '5d9e2a63-8b5c-4e7a-9f1b-0a2c3d4e5f60';
const root = ref('LOC-001', 'Centrála Praha');
const kitchen = ref('LOC-019', '0.19 – Teplá kuchyně');
const brno = ref('LOC-002', 'Centrála Brno');
const sklad = ref('LOC-021', 'Sklad');
const roman = person('Roman Siro');
const scansPath = `/api/v1/inventories/${runId}/scans`;
const scannerUrl = `/inventories/${runId}/scan?locationId=${kitchen.id}`;
const overviewScannerUrl = `/inventories/${runId}/scan`;

type Handler = Parameters<typeof stubApi>[0][string];

const problem = (status: number, code: string) =>
  jsonResponse({ type: 'about:blank', title: code, status, code }, { status, problem: true });

const itemOf = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  code: 'INV-00042',
  name: 'Kávovar Linea PB',
  path: [root, kitchen],
  ...over,
});
const rowOf = (over: Record<string, unknown> = {}) => inventoryRow({ locationId: kitchen.id, ...over });

const found = (over: Record<string, unknown> = {}) => ({
  outcome: 'found',
  item: itemOf(),
  row: rowOf({ checkedAt: '2026-10-03T08:42:00.000Z', checkedBy: roman, method: 'scan' }),
  misplaced: false,
  wasMissing: false,
  ...over,
});

type Options = {
  url?: string;
  role?: string;
  run?: Record<string, unknown>;
  /** Answers the scan; by default a plain "found". */
  scan?: (body: Record<string, unknown>, count: number) => Response | Promise<Response>;
  /** Replaces the answer of the run (for the counter after a scan). */
  runAnswer?: Handler;
};

function openScanner(options: Options = {}) {
  const bodies: Record<string, unknown>[] = [];
  let runReads = 0;
  const calls = stubApi({
    'GET /api/v1/me': () => jsonResponse({ ...me, role: options.role ?? 'write' }),
    [`GET /api/v1/inventories/${runId}`]:
      options.runAnswer ??
      (() => {
        runReads += 1;
        return jsonResponse(
          inventory({
            id: runId,
            location: root,
            path: [root],
            counts: { expected: 128, checked: 84, elsewhere: 0, new: 0, missing: 0 },
            locations: [inventoryLocation({ ...kitchen, path: [root, kitchen], total: 32, checked: 24 })],
            ...options.run,
          }),
        );
      }),
    [`POST ${scansPath}`]: async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return options.scan ? options.scan(body, bodies.length) : jsonResponse(found());
    },
  });
  return { calls, bodies, runReads: () => runReads, ...renderApp(options.url ?? scannerUrl) };
}

/** The camera reads `text` off a label. */
const read = (text: string) =>
  act(() => {
    reader.onCode?.({ text, code: asItemCode(text) });
  });

/** The scanner has loaded its run and is showing the camera. */
const ready = () => screen.findByText('Namiřte na QR štítek položky');

/** The tones the stubbed audio context was asked for, as frequencies. */
const tones: number[] = [];
const vibrate = vi.fn<(pattern: number | number[]) => boolean>(() => true);

// jsdom has neither audio nor vibration: stand-ins that only remember what they were asked for.
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = async () => {};
  createOscillator = () => ({
    type: 'sine',
    frequency: {
      set value(freq: number) {
        tones.push(freq);
      },
    },
    connect: () => {},
    start: () => {},
    stop: () => {},
  });
  createGain = () => ({ gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} });
}

beforeEach(() => {
  tones.length = 0;
  vibrate.mockClear();
  localStorage.clear();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  reader.status = 'running';
  reader.torchSupported = false;
  reader.torchOn = false;
  reader.paused = false;
  reader.onCode = null;
  reader.toggle.mockReset();
  reader.retry.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('inventory scanner', () => {
  describe('the screen', () => {
    it('shows the location, how far it is and the hint, full screen without the top bar of the app', async () => {
      openScanner();
      await ready();
      expect(screen.getByRole('heading', { name: '0.19 – Teplá kuchyně', level: 1 })).toBeInTheDocument();
      expect(screen.getByText('24 / 32')).toBeInTheDocument();
      expect(screen.getByText('24 z 32 zkontrolováno')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zavřít skener' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Správa majetku/ })).not.toBeInTheDocument();
    });

    it('works on the whole run when opened from the overview', async () => {
      const { bodies } = openScanner({ url: overviewScannerUrl });
      await ready();
      expect(screen.getByRole('heading', { name: 'Centrála Praha', level: 1 })).toBeInTheDocument();
      expect(screen.getByText('84 / 128')).toBeInTheDocument();
      expect(screen.getByText('84 z 128 zkontrolováno')).toBeInTheDocument();

      await read('INV-00042');
      await screen.findByText('Nalezeno');
      // No context location: the answer cannot say "misplaced", so none is sent.
      expect(bodies[0]).toEqual({ code: 'INV-00042', method: 'scan' });
    });

    it('ignores a location id that is no id and works on the whole run', async () => {
      openScanner({ url: `${overviewScannerUrl}?locationId=nope` });
      await ready();
      expect(screen.getByRole('heading', { name: 'Centrála Praha', level: 1 })).toBeInTheDocument();
    });

    it('closes back to the checklist when there is nothing to go back to', async () => {
      openScanner();
      await ready();
      expect(screen.getByRole('link', { name: 'Zavřít skener' })).toHaveAttribute(
        'href',
        `/inventories/${runId}/locations/${kitchen.id}`,
      );
    });

    it('shows the counter of the run after a scan counted something', async () => {
      let checked = 84;
      openScanner({
        url: overviewScannerUrl,
        runAnswer: () =>
          jsonResponse(
            inventory({
              id: runId,
              location: root,
              path: [root],
              counts: { expected: 128, checked, elsewhere: 0, new: 0, missing: 0 },
            }),
          ),
        scan: () => {
          checked = 85;
          return jsonResponse(found());
        },
      });
      await ready();
      await read('INV-00042');
      await waitFor(() => expect(screen.getByText('85 z 128 zkontrolováno')).toBeInTheDocument());
    });

    it('counts finds and items flagged as missing as settled, like the bar of the overview', async () => {
      openScanner({
        url: overviewScannerUrl,
        runAnswer: () =>
          jsonResponse(
            inventory({
              id: runId,
              location: root,
              path: [root],
              counts: { expected: 8, checked: 7, elsewhere: 1, new: 1, missing: 1 },
            }),
          ),
      });
      await ready();
      expect(screen.getByText('10 / 10')).toBeInTheDocument();
      expect(screen.getByText('10 z 10 zkontrolováno')).toBeInTheDocument();
    });
  });

  describe('a scan', () => {
    it('sends the code and the location of the checklist and shows "Nalezeno" with the item and its room', async () => {
      const { bodies } = openScanner();
      await ready();

      await read('inv-00042');

      expect(await screen.findByText('Nalezeno')).toBeInTheDocument();
      expect(screen.getByText('Kávovar Linea PB')).toBeInTheDocument();
      expect(screen.getByText('INV-00042 · 0.19 – Teplá kuchyně')).toBeInTheDocument();
      expect(screen.getByText('List se automaticky zavře')).toBeInTheDocument();
      expect(bodies).toEqual([{ code: 'INV-00042', locationId: kitchen.id, method: 'scan' }]);
    });

    it('closes a plain "Nalezeno" by itself after about 2 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      openScanner();
      await ready();
      await read('INV-00042');
      await screen.findByText('Nalezeno');

      await act(() => vi.advanceTimersByTimeAsync(autoCloseMs - 200));
      expect(screen.getByText('Kávovar Linea PB')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(screen.queryByText('Kávovar Linea PB')).not.toBeInTheDocument();
    });

    it('keeps "Nalezeno" of an item that is registered somewhere else, with where it is registered', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      openScanner({ scan: () => jsonResponse(found({ misplaced: true, item: itemOf({ path: [brno, sklad] }) })) });
      await ready();
      await read('INV-00042');

      expect(await screen.findByText('Vedeno v: Centrála Brno › Sklad')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(autoCloseMs * 3));
      expect(screen.getByText('Vedeno v: Centrála Brno › Sklad')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
      expect(screen.queryByText('Vedeno v: Centrála Brno › Sklad')).not.toBeInTheDocument();
    });

    it('tells that the item was missing and that the status is cleared', async () => {
      openScanner({ scan: () => jsonResponse(found({ wasMissing: true })) });
      await ready();
      await read('INV-00042');
      expect(await screen.findByText('Byla nezvěstná')).toBeInTheDocument();
      expect(screen.getByText('Stav Nezvěstná byl zrušen.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Zavřít' })).toBeInTheDocument();
    });

    it('shows "Nalezeno jinde" with where the item is registered, or that it has no location', async () => {
      openScanner({
        scan: (_body, count) =>
          jsonResponse({
            outcome: 'found_elsewhere',
            item: itemOf({ path: count === 1 ? [brno, sklad] : [] }),
            row: rowOf({ kind: 'elsewhere', checkedAt: '2026-10-03T08:42:00.000Z', checkedBy: roman, method: 'scan' }),
            wasMissing: false,
          }),
      });
      await ready();

      await read('INV-00045');
      expect(await screen.findByText('Nalezeno jinde')).toBeInTheDocument();
      expect(screen.getByText('Vedeno v: Centrála Brno › Sklad')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
      await read('INV-00046');
      expect(await screen.findByText('Vedeno v: bez lokality')).toBeInTheDocument();
    });

    it('shows who checked an item already, and when', async () => {
      const at = '2026-10-03T08:42:00.000Z';
      openScanner({
        scan: () =>
          jsonResponse({
            outcome: 'already_checked',
            item: itemOf({ name: 'Myčka nádobí', code: 'INV-00043' }),
            row: rowOf({ checkedAt: at, checkedBy: roman, method: 'scan' }),
          }),
      });
      await ready();
      await read('INV-00043');
      expect(await screen.findByText('Již zkontrolováno')).toBeInTheDocument();
      expect(screen.getByText('Myčka nádobí')).toBeInTheDocument();
      expect(screen.getByText(`Zkontroloval RS v ${formatTime(at)}`)).toBeInTheDocument();
    });

    it('says an archived item is not counted', async () => {
      openScanner({ scan: () => jsonResponse({ outcome: 'archived', item: itemOf({ name: 'Stará tiskárna' }) }) });
      await ready();
      await read('INV-00050');
      expect(await screen.findByText('Archivovaná položka')).toBeInTheDocument();
      expect(screen.getByText('Položka je archivovaná a nezapočítá se.')).toBeInTheDocument();
    });

    it('names an unknown code and carries on with "Skenovat dál"', async () => {
      openScanner({ scan: () => jsonResponse({ outcome: 'unknown_code' }) });
      await ready();
      await read('INV-NOPE-1');
      expect(await screen.findByText('Neznámý kód')).toBeInTheDocument();
      expect(screen.getByText('Žádná položka nemá ID INV-NOPE-1.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Skenovat dál' }));
      expect(screen.queryByText('Neznámý kód')).not.toBeInTheDocument();
    });

    it('does not send a QR code that is not an ID, and says it is not ours', async () => {
      const { calls } = openScanner();
      await ready();
      await read('https://example.com/menu');
      expect(await screen.findByText('Cizí kód')).toBeInTheDocument();
      expect(screen.getByText('Tento kód nepatří do aplikace.')).toBeInTheDocument();
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    });

    it('replaces a sheet by the one of the next reading, and closes a sticky one with Escape', async () => {
      openScanner({
        scan: (_body, count) =>
          count === 1
            ? jsonResponse({ outcome: 'archived', item: itemOf({ name: 'Stará tiskárna' }) })
            : jsonResponse({ outcome: 'unknown_code' }),
      });
      await ready();
      await read('INV-1');
      expect(await screen.findByText('Stará tiskárna')).toBeInTheDocument();
      await read('INV-2');
      expect(await screen.findByText('Neznámý kód')).toBeInTheDocument();
      expect(screen.queryByText('Stará tiskárna')).not.toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByText('Neznámý kód')).not.toBeInTheDocument();
    });

    it('ignores a reading while the one before is still being sent', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { bodies } = openScanner({
        scan: async () => {
          await held;
          return jsonResponse(found());
        },
      });
      await ready();
      await read('INV-1');
      await waitFor(() => expect(bodies).toHaveLength(1));
      await read('INV-2');
      release();
      await screen.findByText('Nalezeno');
      expect(bodies.map((body) => body.code)).toEqual(['INV-1']);
    });

    it('announces what was read to a screen reader', async () => {
      openScanner();
      await ready();
      await read('INV-00042');
      await screen.findByText('Nalezeno');
      expect(screen.getAllByRole('status').some((region) => region.textContent?.startsWith('Nalezeno. Kávovar Linea PB'))).toBe(true);
    });
  });

  describe('when the scan is not saved', () => {
    it('says so and waits: the reader is paused, and "Zkusit znovu" sends the same code', async () => {
      let failing = true;
      const { bodies } = openScanner({
        scan: () => {
          if (failing) return Promise.reject(new TypeError('Failed to fetch'));
          return jsonResponse(found());
        },
      });
      await ready();
      await read('INV-00042');

      expect(await screen.findByText('Sken se neuložil')).toBeInTheDocument();
      expect(screen.getByText('Server není dostupný. Zkontrolujte připojení k internetu a zkuste to znovu.')).toBeInTheDocument();
      expect(reader.paused).toBe(true);

      failing = false;
      await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
      expect(await screen.findByText('Nalezeno')).toBeInTheDocument();
      expect(reader.paused).toBe(false);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual(bodies[0]);
    });

    it('lets the person give up with "Zavřít", and then reads on', async () => {
      openScanner({ scan: () => Promise.reject(new TypeError('Failed to fetch')) });
      await ready();
      await read('INV-00042');
      await screen.findByText('Sken se neuložil');

      await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
      expect(screen.queryByText('Sken se neuložil')).not.toBeInTheDocument();
      expect(reader.paused).toBe(false);
    });

    it('offers another try after a server fault', async () => {
      openScanner({ scan: () => problem(500, 'internal_error') });
      await ready();
      await read('INV-00042');
      expect(await screen.findByText('Sken se neuložil')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    });

    it('sends the person to the overview when the run was ended meanwhile, with no retry', async () => {
      openScanner({ scan: () => problem(409, 'inventory_closed') });
      await ready();
      await read('INV-00042');

      expect(await screen.findByText('Sken se neuložil')).toBeInTheDocument();
      expect(screen.getByText('Inventura už je ukončená.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zpět na přehled inventury' })).toHaveAttribute('href', `/inventories/${runId}`);
    });

    it('offers no retry for a refusal that another try will not change', async () => {
      openScanner({ scan: () => problem(422, 'location_outside_inventory') });
      await ready();
      await read('INV-00042');
      expect(await screen.findByText('Tato lokalita do inventury nepatří.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
    });
  });

  describe('who gets the camera', () => {
    it('refuses a reader', async () => {
      openScanner({ role: 'read' });
      expect(await screen.findByText('K této akci nemáte oprávnění.')).toBeInTheDocument();
      expect(screen.queryByText('Namiřte na QR štítek položky')).not.toBeInTheDocument();
    });

    it('does not scan a run that has ended', async () => {
      openScanner({ run: { status: 'cancelled', endedAt: '2026-10-04T10:00:00.000Z', endedBy: roman } });
      expect(await screen.findByText('Inventura už je ukončená')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zpět na přehled inventury' })).toBeInTheDocument();
      expect(screen.queryByText('Namiřte na QR štítek položky')).not.toBeInTheDocument();
    });

    it('says when the run is not there', async () => {
      openScanner({ runAnswer: () => problem(404, 'not_found') });
      expect(await screen.findByText('Inventura nenalezena')).toBeInTheDocument();
    });

    it('says when the location has nothing to check in this run', async () => {
      openScanner({ run: { locations: [] } });
      expect(await screen.findByText('Lokalita v inventuře není')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zpět na přehled inventury' })).toBeInTheDocument();
    });
  });

  describe('sound and vibration', () => {
    it('beeps and buzzes once for a plain find', async () => {
      openScanner();
      await ready();
      await read('INV-00042');
      await screen.findByText('Nalezeno');
      expect(tones).toEqual([880]);
      expect(vibrate).toHaveBeenCalledExactlyOnceWith(40);
    });

    it('sounds and feels different for each result', async () => {
      const answers: Record<string, () => Response> = {
        'INV-1': () => jsonResponse(found({ wasMissing: true })),
        'INV-2': () => jsonResponse(found({ misplaced: true, item: itemOf({ path: [brno, sklad] }) })),
        'INV-3': () =>
          jsonResponse({
            outcome: 'already_checked',
            item: itemOf(),
            row: rowOf({ checkedAt: '2026-10-03T08:42:00.000Z', checkedBy: roman, method: 'scan' }),
          }),
        'INV-4': () => jsonResponse({ outcome: 'archived', item: itemOf() }),
        'INV-5': () => jsonResponse({ outcome: 'unknown_code' }),
      };
      openScanner({
        scan: (body) => answers[body.code as string]?.() ?? jsonResponse(found()),
      });
      await ready();

      const heard: { tones: number[]; vibration: unknown }[] = [];
      for (const [code, title] of [
        ['INV-1', 'Byla nezvěstná'],
        ['INV-2', 'Nalezeno'],
        ['INV-3', 'Již zkontrolováno'],
        ['INV-4', 'Archivovaná položka'],
        ['INV-5', 'Neznámý kód'],
      ] as const) {
        tones.length = 0;
        vibrate.mockClear();
        await read(code);
        await screen.findByRole('region', { name: title });
        heard.push({ tones: [...tones], vibration: vibrate.mock.calls[0]?.[0] });
      }
      tones.length = 0;
      vibrate.mockClear();
      await read('https://example.com/menu');
      await screen.findByText('Cizí kód');
      heard.push({ tones: [...tones], vibration: vibrate.mock.calls[0]?.[0] });

      expect(heard.map((h) => h.tones)).toEqual([
        [660, 880, 1175],
        [740, 520],
        [587, 587],
        [330],
        [200, 200],
        [300],
      ]);
      expect(new Set(heard.map((h) => JSON.stringify(h.vibration))).size).toBe(heard.length);
    });

    it('has a low falling sound and a long buzz for a scan that was not saved', async () => {
      openScanner({ scan: () => problem(500, 'internal_error') });
      await ready();
      await read('INV-00042');
      await screen.findByText('Sken se neuložil');
      expect(tones).toEqual([260, 220, 180]);
      expect(vibrate).toHaveBeenCalledExactlyOnceWith([120, 60, 120, 60, 120]);
    });

    it('can be silenced, remembers that, and still vibrates', async () => {
      openScanner();
      await ready();
      const button = screen.getByRole('button', { name: 'Zvuk' });
      expect(button).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(localStorage.getItem('scanner-sound')).toBe('off');

      tones.length = 0;
      await read('INV-00042');
      await screen.findByText('Nalezeno');
      expect(tones).toEqual([]);
      expect(vibrate).toHaveBeenCalledExactlyOnceWith(40);
    });

    it('starts silent when it was switched off before, and plays a sample when it is switched on', async () => {
      localStorage.setItem('scanner-sound', 'off');
      openScanner();
      await ready();
      const button = screen.getByRole('button', { name: 'Zvuk' });
      expect(button).toHaveAttribute('aria-pressed', 'false');

      await userEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(localStorage.getItem('scanner-sound')).toBe('on');
      expect(tones).toEqual([880]);
      // The sample is for the ear only.
      expect(vibrate).not.toHaveBeenCalled();
    });

    it('works on a phone with neither audio nor vibration', async () => {
      vi.stubGlobal('AudioContext', undefined);
      Reflect.deleteProperty(navigator, 'vibrate');
      openScanner();
      await ready();
      await read('INV-00042');
      expect(await screen.findByText('Nalezeno')).toBeInTheDocument();
    });
  });

  describe('the camera', () => {
    it('says it is starting', async () => {
      reader.status = 'starting';
      openScanner();
      expect(await screen.findByText('Spouštím kameru…')).toBeInTheDocument();
      expect(screen.queryByText('Namiřte na QR štítek položky')).not.toBeInTheDocument();
    });

    it('explains how to allow a refused camera and offers to check by hand instead', async () => {
      reader.status = 'denied';
      openScanner();

      expect(await screen.findByText('Kamera není povolená')).toBeInTheDocument();
      expect(screen.getByText(/iPhone \(Safari\)/)).toBeInTheDocument();
      expect(screen.getByText(/Android \(Chrome\)/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Kontrolovat ručně' })).toHaveAttribute(
        'href',
        `/inventories/${runId}/locations/${kitchen.id}`,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
      expect(reader.retry).toHaveBeenCalledOnce();
    });

    it('says there is no camera, with no retry, and leads to the overview from there', async () => {
      reader.status = 'unavailable';
      openScanner({ url: overviewScannerUrl });
      expect(await screen.findByText('Kamera nebyla nalezena')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Kontrolovat ručně' })).toHaveAttribute('href', `/inventories/${runId}`);
    });

    it('says when the camera would not start', async () => {
      reader.status = 'error';
      openScanner();
      expect(await screen.findByText('Kameru se nepodařilo spustit')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
    });

    it('shows no torch button where the phone has none', async () => {
      openScanner();
      await ready();
      expect(screen.queryByRole('button', { name: 'Baterka' })).not.toBeInTheDocument();
    });

    it('has a torch button that is pressed while the torch is on', async () => {
      reader.torchSupported = true;
      reader.torchOn = true;
      openScanner();
      await ready();
      const button = screen.getByRole('button', { name: 'Baterka' });
      expect(button).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(button);
      expect(reader.toggle).toHaveBeenCalledOnce();
    });
  });
});
