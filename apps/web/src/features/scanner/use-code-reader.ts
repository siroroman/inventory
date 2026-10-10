import { useEffect, useRef } from 'react';
import { type QrDecoder, createQrDecoder } from './qr-decoder';
import { asItemCode, createScanGate } from './scan-gate';
import { useCamera } from './use-camera';

/** Time between two looks at the picture, counted from the end of the last decode. */
export const decodeIntervalMs = 120;

/**
 * A code the camera read: `text` as it is on the label, `code` as an item ID, or null when the text
 * has not the form of one (a QR code that is not ours).
 */
export type CodeReading = { text: string; code: string | null };

/**
 * The camera plus the decoder: calls `onCode` once per label that comes into view (a label that stays
 * in view is not reported again, see `createScanGate`). While `paused` the camera keeps showing the
 * picture but nothing is read. The decoder is loaded on first use.
 */
export function useCodeReader({ paused, onCode }: { paused: boolean; onCode: (reading: CodeReading) => void }) {
  const camera = useCamera();
  const gate = useRef(createScanGate());
  const decoder = useRef<Promise<QrDecoder> | null>(null);
  // The latest callback, so the loop below is not restarted by every render of the screen.
  const handler = useRef(onCode);
  handler.current = onCode;
  const { status, videoRef } = camera;

  useEffect(() => {
    if (status !== 'running' || paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A decoder that failed to load (no connection for its chunk) is asked for again at the next look.
    decoder.current ??= createQrDecoder().catch((error: unknown) => {
      decoder.current = null;
      throw error;
    });
    // Labels that were in view while the reader was paused count as new when it resumes.
    gate.current.reset();

    const look = async () => {
      if (stopped) return;
      const video = videoRef.current;
      try {
        // Two frames in, the video has a picture to read.
        const text = video && video.readyState >= 2 ? await (await decoder.current!)(video) : null;
        if (text && !stopped) {
          const code = asItemCode(text);
          if (gate.current.accept(code ?? text.trim())) handler.current({ text, code });
        }
      } catch {
        // A frame that cannot be read is the same as one without a code.
      }
      if (!stopped) timer = setTimeout(look, decodeIntervalMs);
    };
    void look();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [status, paused, videoRef]);

  return camera;
}
