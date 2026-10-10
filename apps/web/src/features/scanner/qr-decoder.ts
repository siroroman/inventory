/** Reads the text of a QR code from the current picture of a video, or null when there is none. */
export type QrDecoder = (video: HTMLVideoElement) => Promise<string | null>;

// Longest side of the picture handed to a decoder: a 28 mm label at arm's length
// still has 3 or more pixels per module, and a decode stays well under 50 ms.
const maxSide = 640;

type NativeDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type NativeDetectorClass = {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?(): Promise<string[]>;
};

/**
 * Draws the middle square of the video, where the viewfinder is, scaled down, into one canvas that
 * is reused for every look. Both decoders read it, so a label outside the frame is ignored whichever
 * one the browser has. Null while the video has no picture yet.
 */
function squareCropper() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return (video: HTMLVideoElement) => {
    const { videoWidth, videoHeight } = video;
    if (!context || videoWidth === 0 || videoHeight === 0) return null;
    const side = Math.min(videoWidth, videoHeight);
    const size = Math.min(side, maxSide);
    canvas.width = size;
    canvas.height = size;
    context.drawImage(video, (videoWidth - side) / 2, (videoHeight - side) / 2, side, side, 0, 0, size, size);
    return { canvas, context, size };
  };
}

/** The browser's own detector when it reads QR codes (Chrome on Android); iOS Safari has none. */
async function nativeDecoder(): Promise<QrDecoder | null> {
  const Detector = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = await Detector.getSupportedFormats?.();
    if (formats && !formats.includes('qr_code')) return null;
    const detector = new Detector({ formats: ['qr_code'] });
    const crop = squareCropper();
    return async (video) => {
      const square = crop(video);
      return square ? ((await detector.detect(square.canvas))[0]?.rawValue ?? null) : null;
    };
  } catch {
    return null;
  }
}

/** jsQR, loaded only when the scanner needs it (its own chunk, same origin, so the CSP stays as it is). */
async function scriptDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import('jsqr');
  const crop = squareCropper();
  return async (video) => {
    const square = crop(video);
    if (!square) return null;
    const { context, size } = square;
    const image = context.getImageData(0, 0, size, size);
    // Labels are black on white, so the inverted pass would only cost time.
    return jsQR(image.data, size, size, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** The best decoder this browser has: its own detector, else the JavaScript one. */
export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? (await scriptDecoder());
}
