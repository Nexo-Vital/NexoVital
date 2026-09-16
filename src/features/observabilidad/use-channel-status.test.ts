import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('useChannelStatus', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reflects the realtime port state when the dev relay is available', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', true);

    const { useChannelStatus } = await import('./use-channel-status');
    const { result } = renderHook(() => useChannelStatus());

    // No socket is connected in this test, so the port reports DISCONNECTED
    // instead of the old fake CONNECTED.
    expect(result.current.state).toBe('DISCONNECTED');
    expect(result.current.latencyMs).toBeNull();
  });

  it('uses the realtime port in a production build too (no DEV guard)', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);

    const { useChannelStatus } = await import('./use-channel-status');
    const { result } = renderHook(() => useChannelStatus());

    // The relay now exists in production (Durable Object), so the badge mirrors
    // the real port state instead of the old mock CONNECTED fallback.
    expect(result.current.state).toBe('DISCONNECTED');
    expect(result.current.latencyMs).toBeNull();
  });
});
