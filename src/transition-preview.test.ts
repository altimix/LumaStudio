import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransitionPreview } from './transition-preview';

const gpu = vi.hoisted(() => ({ unavailable: true, lost: false, canvas: undefined as HTMLCanvasElement | undefined }));
vi.mock('./gpu-transition', () => ({ GpuTransition: class {
  canvas: HTMLCanvasElement;
  constructor() { if (gpu.unavailable) throw Error('Unavailable'); this.canvas = document.createElement('canvas'); gpu.canvas = this.canvas; }
  get lost() { return gpu.lost; }
  render() { return !gpu.lost; }
  dispose() { this.canvas.width = this.canvas.height = 0; }
} }));
class Bitmap { closed = false; close() { this.closed = true; } }
class Background {
  static instances: Background[] = [];
  onmessage?: (event: { data: { key?: string; bitmap?: Bitmap; error?: string } }) => void;
  onerror?: (event: unknown) => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { Background.instances.push(this); }
}
const canvas = () => ({ width: 1920, height: 1080, getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }) }) as unknown as HTMLCanvasElement;
beforeEach(() => {
  gpu.unavailable = true; gpu.lost = false; gpu.canvas = undefined; Background.instances = [];
  vi.stubGlobal('document', { createElement: canvas }); vi.stubGlobal('ImageBitmap', Bitmap); vi.stubGlobal('Worker', Background);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => new Bitmap()));
});
afterEach(() => vi.unstubAllGlobals());
const pending = async () => { await vi.waitFor(() => expect(Background.instances[0].postMessage).toHaveBeenCalledOnce()); return Background.instances[0]; };

describe('transition rendering lifecycle', () => {
  it('retries the GPU at a smaller quality and discards the old worker size', async () => {
    const renderer = new TransitionPreview(vi.fn()), large = canvas();
    const stamp = { time: 3, revision: 4, width: 1920, height: 1080, kind: 'pagePeel' };
    renderer.request('large', 'pagePeel', large, large, .5, stamp); const worker = await pending();
    worker.onmessage!({ data: { key: 'large', bitmap: new Bitmap() } });
    gpu.unavailable = false;
    renderer.request('same-size', 'pagePeel', large, large, .6, stamp);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    expect(renderer.backend).toBe('worker');
    const small = canvas(); small.width = 480; small.height = 270;
    renderer.request('small', 'pagePeel', small, small, .6, { ...stamp, width: 480, height: 270 });
    expect(renderer.backend).toBe('gpu'); expect(renderer.key).toBe('small');
    const stale = new Bitmap(); worker.onmessage!({ data: { key: 'same-size', bitmap: stale } });
    expect(stale.closed).toBe(true); expect(renderer.key).toBe('small'); renderer.dispose();
  });
  it('associates accepted worker frames with their original timeline metadata', async () => {
    const renderer = new TransitionPreview(vi.fn()), a = canvas(), b = canvas();
    const stamp = { time: 3, revision: 4, width: 1920, height: 1080, kind: 'pagePeel' };
    renderer.request('frame-3', 'pagePeel', a, b, .5, stamp); const worker = await pending();
    renderer.request('frame-4', 'pagePeel', a, b, .6, { ...stamp, time: 4 });
    worker.onmessage!({ data: { key: 'frame-3', bitmap: new Bitmap() } });
    expect(renderer.frameStamp).toEqual(stamp); expect(renderer.key).toBe('frame-3'); renderer.dispose();
  });
  it('rejects a late frame from a previous project even when the effect kind is unchanged', async () => {
    const renderer = new TransitionPreview(vi.fn()), a = canvas(), b = canvas();
    const stamp = { time: 3, revision: 4, width: 1920, height: 1080, kind: 'pagePeel' };
    renderer.request('old-project', 'pagePeel', a, b, .5, stamp); const worker = await pending();
    renderer.request('new-project', 'pagePeel', a, b, .5, { ...stamp, revision: 5 });
    const old = new Bitmap(); worker.onmessage!({ data: { key: 'old-project', bitmap: old } });
    expect(old.closed).toBe(true); expect(renderer.bitmap).toBeUndefined(); expect(renderer.frameStamp).toBeUndefined(); renderer.dispose();
  });
  it('keeps fallback work single-flight and ignores a late result after changing to dissolve', async () => {
    const error = vi.fn(), renderer = new TransitionPreview(error), a = canvas(), b = canvas();
    renderer.request('peel-1', 'pagePeel', a, b, .2);
    renderer.request('peel-2', 'pagePeel', a, b, .3);
    const worker = await pending();
    const message = worker.postMessage.mock.calls[0][0]; expect(message.width).toBe(640); expect(message.height).toBe(360);
    renderer.request('dissolve', 'dissolve', a, b, .5); const visible = renderer.bitmap;
    const late = new Bitmap(); worker.onmessage!({ data: { key: 'peel-1', bitmap: late } });
    expect(late.closed).toBe(true); expect(renderer.key).toBe('dissolve'); expect(renderer.bitmap).toBe(visible); expect(error).not.toHaveBeenCalled();
    renderer.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('drops delayed snapshots when the requested effect changes before worker dispatch', async () => {
    const resolvers: ((bitmap: Bitmap) => void)[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<Bitmap>(resolve => resolvers.push(resolve))));
    const renderer = new TransitionPreview(vi.fn()), a = canvas(), b = canvas();
    renderer.request('peel', 'pagePeel', a, b, .3); renderer.request('dissolve', 'dissolve', a, b, .5);
    const left = new Bitmap(), right = new Bitmap(); resolvers[0](left); resolvers[1](right);
    await vi.waitFor(() => expect(left.closed && right.closed).toBe(true));
    expect(Background.instances[0].postMessage).not.toHaveBeenCalled(); expect(renderer.key).toBe('dissolve'); renderer.dispose();
  });
  it('recovers context loss at an unchanged paused frame without drawing a released canvas', async () => {
    gpu.unavailable = false;
    const renderer = new TransitionPreview(vi.fn()), a = canvas(), b = canvas();
    renderer.request('paused', 'pagePeel', a, b, .5); expect(renderer.backend).toBe('gpu');
    gpu.lost = true; renderer.request('paused', 'pagePeel', a, b, .5);
    expect(renderer.bitmap).toBeUndefined(); expect(gpu.canvas!.width).toBe(0);
    const worker = await pending(), result = new Bitmap(); worker.onmessage!({ data: { key: 'paused', bitmap: result } });
    expect(renderer.backend).toBe('worker'); expect(renderer.bitmap).toBe(result); renderer.dispose(); expect(result.closed).toBe(true);
  });
  it('closes a successful snapshot when its partner fails and reports the failure once', async () => {
    const left = new Bitmap(), error = vi.fn(), renderer = new TransitionPreview(error);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(left).mockRejectedValueOnce(Error('Snapshot failed')));
    renderer.request('peel', 'pagePeel', canvas(), canvas(), .3);
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce()); expect(left.closed).toBe(true);
    renderer.request('again', 'pagePeel', canvas(), canvas(), .4); expect(error).toHaveBeenCalledOnce(); renderer.dispose();
  });
  it('does not stop a new dissolve when a stale fallback worker crashes', async () => {
    const error = vi.fn(), renderer = new TransitionPreview(error), a = canvas(), b = canvas();
    renderer.request('peel', 'pagePeel', a, b, .3); const worker = await pending();
    renderer.request('dissolve', 'dissolve', a, b, .4);
    worker.onerror!({ preventDefault: vi.fn(), message: 'Old worker failed' });
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
    renderer.request('dissolve-next', 'dissolve', a, b, .5);
    expect(renderer.key).toBe('dissolve-next'); renderer.dispose();
  });
});
