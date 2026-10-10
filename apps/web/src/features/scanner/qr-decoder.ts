/** Reads the text of a QR code from the current picture of a video, or null when there is none. */
export type QrDecoder = (video: HTMLVideoElement) => Promise<string | null>;

// Longest side of the picture handed to the JavaScript decoder: a 28 mm label at arm's length
// still has 3 or more pixels per module, and a decode stays well under 50 ms.
const maxSide = 640;

type NativeDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type NativeDetectorClass = {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?(): Promise<string[]>;
};

/** The browser's own detector when it reads QR codes (Chrome on Android); iOS Safari has none. */
async function nativeDecoder(): Promise<QrDecoder | null> {
  const Detector = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = await Detector.getSupportedFormats?.();
    if (formats && !formats.includes('qr_code')) return null;
    const detector = new Detector({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

/**
 * jsQR, loaded only when the scanner needs it (its own chunk, same origin, so the CSP stays as it
 * is). It gets the middle square of the picture, where the viewfinder is, scaled down.
 */
async function scriptDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const { videoWidth, videoHeight } = video;
    if (!context || videoWidth === 0 || videoHeight === 0) return null;
    const side = Math.min(videoWidth, videoHeight);
    const size = Math.min(side, maxSide);
    canvas.width = size;
    canvas.height = size;
    context.drawImage(video, (videoWidth - side) / 2, (videoHeight - side) / 2, side, side, 0, 0, size, size);
    const image = context.getImageData(0, 0, size, size);
    // Labels are black on white, so the inverted pass would only cost time.
    return jsQR(image.data, size, size, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** The best decoder this browser has: its own detector, else the JavaScript one. */
export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? (await scriptDecoder());
}
