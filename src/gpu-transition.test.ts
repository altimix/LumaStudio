import { describe, expect, it, vi } from 'vitest';
import { GpuTransitionPool, type GpuTransition } from './gpu-transition';

const fake = () => ({ lost: false, reset: vi.fn(), dispose: vi.fn() }) as unknown as GpuTransition;

describe('transition GPU resource limits', () => {
  it('reuses compiled contexts, bounds leases and frees excess idle contexts', () => {
    const create = vi.fn(fake), pool = new GpuTransitionPool(create);
    const leased = Array.from({ length: 4 }, () => pool.take());
    expect(() => pool.take()).toThrow();
    leased.forEach(gpu => pool.release(gpu));
    expect(leased[0].reset).toHaveBeenCalledOnce();
    expect(leased[1].reset).toHaveBeenCalledOnce();
    expect(leased[2].dispose).toHaveBeenCalledOnce();
    expect(leased[3].dispose).toHaveBeenCalledOnce();
    const reused = pool.take(); expect(create).toHaveBeenCalledTimes(4);
    pool.dispose(); expect(reused.dispose).toHaveBeenCalledOnce();
    pool.release(reused); expect(reused.dispose).toHaveBeenCalledOnce();
    expect(() => pool.take()).toThrow();
  });
  it('discards a context lost while idle and disposes a lost active context', () => {
    const create = vi.fn(fake), pool = new GpuTransitionPool(create), first = pool.take();
    pool.release(first); Object.defineProperty(first, 'lost', { value: true });
    const replacement = pool.take(); expect(replacement).not.toBe(first);
    expect(first.dispose).toHaveBeenCalledOnce();
    Object.defineProperty(replacement, 'lost', { value: true });
    pool.release(replacement); expect(replacement.dispose).toHaveBeenCalledOnce();
    expect(replacement.reset).not.toHaveBeenCalled(); pool.dispose();
  });
});
