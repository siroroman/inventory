import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from '../src/features/scanner/use-camera.ts';

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => Record<string, unknown>;
  applyConstraints: ReturnType<typeof vi.fn>;
};

function fakeStream(capabilities: Record<string, unknown> = {}) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => capabilities,
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function stubMediaDevices(getUserMedia: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function Probe({ enabled = true }: { enabled?: boolean }) {
  const camera = useCamera(enabled);
  return (
    <div>
      <video ref={camera.videoRef} data-testid="video" muted />
      <p data-testid="status">{camera.status}</p>
      <p data-testid="torch">{camera.torch.supported ? (camera.torch.on ? 'on' : 'off') : 'none'}</p>
      <button type="button" onClick={() => void camera.torch.toggle()}>
        toggle
      </button>
      <button type="button" onClick={camera.retry}>
        retry
      </button>
    </div>
  );
}

const status = () => screen.getByTestId('status').textContent;

describe('useCamera', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    setVisibility('visible');
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('asks for the rear camera without sound, shows it in the video and runs', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);

    render(<Probe />);
    expect(status()).toBe('starting');
    await waitFor(() => expect(status()).toBe('running'));

    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    expect((screen.getByTestId('video') as HTMLVideoElement).srcObject).toBe(stream);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
    ['NotReadableError', 'error'],
  ])('reports %s as %s', async (name, expected) => {
    stubMediaDevices(vi.fn().mockRejectedValue(new DOMException('no', name)));
    render(<Probe />);
    await waitFor(() => expect(status()).toBe(expected));
  });

  it('is unavailable where the page may not use the camera at all (no HTTPS)', async () => {
    render(<Probe />);
    await waitFor(() => expect(status()).toBe('unavailable'));
  });

  it('stops the camera when the screen is left', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices(vi.fn().mockResolvedValue(stream));
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(status()).toBe('running'));
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops in the background and starts again when the app comes back', async () => {
    const first = fakeStream();
    const second = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    stubMediaDevices(getUserMedia);
    render(<Probe />);
    await waitFor(() => expect(status()).toBe('running'));

    act(() => setVisibility('hidden'));
    expect(first.track.stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status()).toBe('running'));
  });

  it('does not open the camera while disabled', async () => {
    const getUserMedia = vi.fn();
    stubMediaDevices(getUserMedia);
    render(<Probe enabled={false} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('stops a stream that arrives after the screen was left', async () => {
    const { stream, track } = fakeStream();
    let resolve!: (value: MediaStream) => void;
    stubMediaDevices(vi.fn().mockReturnValue(new Promise<MediaStream>((r) => (resolve = r))));
    const { unmount } = render(<Probe />);
    unmount();
    await act(async () => resolve(stream));
    expect(track.stop).toHaveBeenCalled();
  });

  it('asks again on retry, for a person who changed the permission', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
      .mockResolvedValueOnce(stream);
    stubMediaDevices(getUserMedia);
    render(<Probe />);
    await waitFor(() => expect(status()).toBe('denied'));

    act(() => screen.getByRole('button', { name: 'retry' }).click());
    await waitFor(() => expect(status()).toBe('running'));
  });

  describe('torch', () => {
    it('is offered only when the camera reports it, and switches the track', async () => {
      const { stream, track } = fakeStream({ torch: true });
      stubMediaDevices(vi.fn().mockResolvedValue(stream));
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('torch').textContent).toBe('off'));

      act(() => screen.getByRole('button', { name: 'toggle' }).click());
      await waitFor(() => expect(screen.getByTestId('torch').textContent).toBe('on'));
      expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    });

    it('is not offered when the camera has none (iOS Safari)', async () => {
      const { stream } = fakeStream({ zoom: { min: 1, max: 4 } });
      stubMediaDevices(vi.fn().mockResolvedValue(stream));
      render(<Probe />);
      await waitFor(() => expect(status()).toBe('running'));
      expect(screen.getByTestId('torch').textContent).toBe('none');
    });

    it('is withdrawn when the phone refuses it', async () => {
      const { stream, track } = fakeStream({ torch: true });
      track.applyConstraints.mockRejectedValue(new DOMException('no', 'NotSupportedError'));
      stubMediaDevices(vi.fn().mockResolvedValue(stream));
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('torch').textContent).toBe('off'));

      act(() => screen.getByRole('button', { name: 'toggle' }).click());
      await waitFor(() => expect(screen.getByTestId('torch').textContent).toBe('none'));
    });
  });
});
