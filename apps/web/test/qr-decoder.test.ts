import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jsQR = vi.hoisted(() => vi.fn());
vi.mock('jsqr', () => ({ default: jsQR }));

import { createQrDecoder } from '../src/features/scanner/qr-decoder.ts';

const video = (width: number, height: number) => ({ videoWidth: width, videoHeight: height }) as HTMLVideoElement;

describe('createQrDecoder', () => {
  const drawImage = vi.fn();

  beforeEach(() => {
    jsQR.mockReset();
    drawImage.mockReset();
    // jsdom has no canvas: a 2D context that records what is drawn and hands out an empty picture.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'BarcodeDetector');
  });

  function stubDetector(formats: string[] | undefined, found: string[] = []) {
    const detect = vi.fn(async () => found.map((rawValue) => ({ rawValue })));
    class Detector {
      static getSupportedFormats = formats && (async () => formats);
      detect = detect;
    }
    Object.defineProperty(window, 'BarcodeDetector', { value: Detector, configurable: true });
    return detect;
  }

  it("uses the browser's own detector when it reads QR codes, and never loads jsQR", async () => {
    const detect = stubDetector(['qr_code', 'ean_13'], ['INV-00042']);
    const decode = await createQrDecoder();
    const picture = video(720, 1280);
    expect(await decode(picture)).toBe('INV-00042');
    // It is given the middle square, like jsQR, so a label outside the viewfinder is not read.
    expect(drawImage).toHaveBeenCalledWith(picture, 0, 280, 720, 720, 0, 0, 640, 640);
    expect(detect).toHaveBeenCalledWith(expect.any(HTMLCanvasElement));
    expect(jsQR).not.toHaveBeenCalled();
  });

  it('answers null while the video has no picture yet, without asking the native detector', async () => {
    const detect = stubDetector(['qr_code'], ['INV-00042']);
    expect(await (await createQrDecoder())(video(0, 0))).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });

  it('answers null when the native detector sees nothing', async () => {
    stubDetector(['qr_code'], []);
    expect(await (await createQrDecoder())(video(720, 1280))).toBeNull();
  });

  it('uses jsQR where there is no detector (iOS Safari)', async () => {
    jsQR.mockReturnValue({ data: 'INV-00042' });
    const decode = await createQrDecoder();
    expect(await decode(video(720, 1280))).toBe('INV-00042');
  });

  it('uses jsQR where the detector cannot read QR codes', async () => {
    stubDetector(['ean_13', 'code_128']);
    jsQR.mockReturnValue(null);
    const decode = await createQrDecoder();
    expect(await decode(video(720, 1280))).toBeNull();
    expect(jsQR).toHaveBeenCalledOnce();
  });

  it('gives jsQR the middle square of the picture, scaled down, without the inverted pass', async () => {
    jsQR.mockReturnValue(null);
    const decode = await createQrDecoder();
    const picture = video(720, 1280);
    await decode(picture);
    // The square is 720 x 720 from y = 280, drawn at 640 x 640.
    expect(drawImage).toHaveBeenCalledWith(picture, 0, 280, 720, 720, 0, 0, 640, 640);
    expect(jsQR).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 640, 640, { inversionAttempts: 'dontInvert' });
  });

  it('keeps a small picture at its size', async () => {
    jsQR.mockReturnValue(null);
    const decode = await createQrDecoder();
    await decode(video(480, 320));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 80, 0, 320, 320, 0, 0, 320, 320);
  });

  it('answers null while the video has no picture yet', async () => {
    const decode = await createQrDecoder();
    expect(await decode(video(0, 0))).toBeNull();
    expect(jsQR).not.toHaveBeenCalled();
  });
});
