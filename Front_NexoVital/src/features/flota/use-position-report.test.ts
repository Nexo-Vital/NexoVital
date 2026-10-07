import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/apiClient';
import type { Ubicacion } from '@/types/domain';
import { POSITION_REPORT_INTERVAL_MS, usePositionReport } from './use-position-report';

const { mockReportar } = vi.hoisted(() => ({ mockReportar: vi.fn() }));

vi.mock('./fleet-api', () => ({
  reportarPosicion: mockReportar,
}));

const UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';
const HERE: Ubicacion = { lat: 4.745, lng: -74.095 };
const THERE: Ubicacion = { lat: 4.75, lng: -74.09 };

interface Props {
  enabled: boolean;
  ambulanciaId: string;
  position: Ubicacion | null;
  heading: number | null;
}

function mount(initial: Partial<Props> = {}) {
  const props: Props = {
    enabled: true,
    ambulanciaId: UNIT,
    position: HERE,
    heading: null,
    ...initial,
  };
  return renderHook((current: Props) => usePositionReport(current), { initialProps: props });
}

/** Lets the pending `.catch().finally()` of a settled report run. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('usePositionReport (EP-04.F1.US1, D2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReportar.mockReset();
    mockReportar.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('P14: reports at once and then every 5 s', async () => {
    mount();
    await flush();
    expect(mockReportar).toHaveBeenCalledTimes(1);
    expect(mockReportar).toHaveBeenLastCalledWith(UNIT, HERE, null);

    await advance(POSITION_REPORT_INTERVAL_MS);
    expect(mockReportar).toHaveBeenCalledTimes(2);

    await advance(POSITION_REPORT_INTERVAL_MS);
    expect(mockReportar).toHaveBeenCalledTimes(3);
  });

  it('keeps the 5 s cadence when the GPS moves in between, and sends the latest position', async () => {
    const hook = mount();
    await flush();

    // Three GPS updates inside one cycle must not produce three reports.
    hook.rerender({ enabled: true, ambulanciaId: UNIT, position: THERE, heading: 10 });
    hook.rerender({ enabled: true, ambulanciaId: UNIT, position: HERE, heading: 20 });
    hook.rerender({ enabled: true, ambulanciaId: UNIT, position: THERE, heading: 30 });
    await advance(POSITION_REPORT_INTERVAL_MS - 1);
    expect(mockReportar).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(mockReportar).toHaveBeenCalledTimes(2);
    expect(mockReportar).toHaveBeenLastCalledWith(UNIT, THERE, 30);
  });

  it('reports a parked vehicle too: the heartbeat is what keeps its signal', async () => {
    mount();
    await flush();

    await advance(POSITION_REPORT_INTERVAL_MS * 3);

    expect(mockReportar).toHaveBeenCalledTimes(4);
    expect(mockReportar).toHaveBeenLastCalledWith(UNIT, HERE, null);
  });

  it('skips the cycle while a report is still in flight (never two at a time)', async () => {
    let settle: () => void = () => {};
    mockReportar.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    mount();
    await flush();
    expect(mockReportar).toHaveBeenCalledTimes(1);

    // The first report has not answered: two cycles pass and nothing is sent.
    await advance(POSITION_REPORT_INTERVAL_MS * 2);
    expect(mockReportar).toHaveBeenCalledTimes(1);

    settle();
    await flush();
    await advance(POSITION_REPORT_INTERVAL_MS);
    expect(mockReportar).toHaveBeenCalledTimes(2);
  });

  it('does not report while disabled, without a unit or without an own position', async () => {
    mount({ enabled: false });
    mount({ ambulanciaId: '' });
    mount({ position: null });
    await flush();

    await advance(POSITION_REPORT_INTERVAL_MS * 2);

    expect(mockReportar).not.toHaveBeenCalled();
  });

  it('stops when the driver disconnects and resumes when they connect again', async () => {
    const hook = mount();
    await flush();
    expect(mockReportar).toHaveBeenCalledTimes(1);

    hook.rerender({ enabled: false, ambulanciaId: UNIT, position: HERE, heading: null });
    await advance(POSITION_REPORT_INTERVAL_MS * 3);
    expect(mockReportar).toHaveBeenCalledTimes(1);

    hook.rerender({ enabled: true, ambulanciaId: UNIT, position: HERE, heading: null });
    await flush();
    expect(mockReportar).toHaveBeenCalledTimes(2);
  });

  it('stops on unmount', async () => {
    const hook = mount();
    await flush();

    hook.unmount();
    await advance(POSITION_REPORT_INTERVAL_MS * 3);

    expect(mockReportar).toHaveBeenCalledTimes(1);
  });

  it('keeps trying after a transient failure (network down, 500)', async () => {
    mockReportar.mockRejectedValueOnce(new ApiError(0, 'No se pudo conectar al servidor'));
    mount();
    await flush();

    await advance(POSITION_REPORT_INTERVAL_MS);

    expect(mockReportar).toHaveBeenCalledTimes(2);
  });

  it('stops insisting when the server says the unit belongs to another driver (409)', async () => {
    mockReportar.mockRejectedValueOnce(
      new ApiError(409, 'La unidad no es tuya', 'AMBULANCIA_AJENA'),
    );
    mount();
    await flush();

    await advance(POSITION_REPORT_INTERVAL_MS * 3);

    expect(mockReportar).toHaveBeenCalledTimes(1);
  });
});
