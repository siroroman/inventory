import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `denied`: the person (or the browser) refused the camera. `unavailable`: there is none, or the
 * page is not allowed to ask (not on HTTPS). `error`: it exists but did not start (another app has it).
 */
export type CameraStatus = 'starting' | 'running' | 'denied' | 'unavailable' | 'error';

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

function statusOfError(error: unknown): CameraStatus {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'unavailable';
  return 'error';
}

/**
 * The rear camera of the phone, shown in the `<video>` that `videoRef` is put on. It is on while
 * the screen is visible and `enabled`: it stops when the app goes to the background and starts
 * again when it comes back, so the camera light never stays on behind the person's back.
 */
export function useCamera(enabled = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only exists to run the effect again (retry)
  useEffect(() => {
    if (!enabled || !visible) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    setStatus('starting');

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        setTorchSupported((track?.getCapabilities?.() as TorchCapabilities | undefined)?.torch === true);
        setTorchOn(false);
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        if (!cancelled) setStatus('running');
      } catch (error) {
        if (!cancelled) setStatus(statusOfError(error));
      }
    })();

    return () => {
      cancelled = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
      trackRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled, visible, attempt]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      // The phone said no after all: do not offer it again.
      setTorchSupported(false);
      setTorchOn(false);
    }
  }, [torchOn]);

  return {
    videoRef,
    status,
    torch: { supported: torchSupported, on: torchOn, toggle: toggleTorch },
    /** Asks for the camera again, after the person changed the permission. */
    retry: () => setAttempt((n) => n + 1),
  };
}
