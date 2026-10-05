import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { CONNECTION_BANNER_DELAY_MS, ConnectionBanner } from './ConnectionBanner';

describe('ConnectionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows nothing while the channel is connected', () => {
    render(<ConnectionBanner port={new FakeRealtimePort()} />);
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS * 2));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the banner once the channel has been down for the grace period', () => {
    const port = new FakeRealtimePort();
    render(<ConnectionBanner port={port} />);

    act(() => port.setState('STALE'));
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS - 1));
    expect(screen.queryByRole('status')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando');
  });

  it('never flashes for a drop shorter than the grace period', () => {
    const port = new FakeRealtimePort();
    render(<ConnectionBanner port={port} />);

    act(() => port.setState('STALE'));
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS - 100));
    act(() => port.setState('CONNECTED'));
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides the banner as soon as the channel is back', () => {
    const port = new FakeRealtimePort();
    render(<ConnectionBanner port={port} />);
    act(() => port.setState('STALE'));
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => port.setState('CONNECTED'));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('covers a channel that never connected (backend down on load)', () => {
    const port = new FakeRealtimePort();
    port.state = 'STALE';
    render(<ConnectionBanner port={port} />);

    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS));

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('is off with a null port', () => {
    render(<ConnectionBanner port={null} />);
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS * 2));

    expect(screen.queryByRole('status')).toBeNull();
  });
});
