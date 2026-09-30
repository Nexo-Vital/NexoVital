import type {
  RealtimeEnvelope,
  RealtimeHandler,
  RealtimePort,
  RealtimeState,
} from '@/shared/realtime';

/**
 * In-memory RealtimePort double for tests. Drive it with `emit` to simulate the
 * relay pushing a message; inspect `published` for outgoing frames.
 */
export class FakeRealtimePort implements RealtimePort {
  state: RealtimeState = 'CONNECTED';
  readonly published: { destination: string; payload: unknown }[] = [];
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly stateHandlers = new Set<(state: RealtimeState) => void>();

  connect(): void {}
  disconnect(): void {}

  publish<T>(destination: string, payload: T): void {
    this.published.push({ destination, payload });
  }

  subscribe<T>(destination: string, handler: RealtimeHandler<T>): () => void {
    const set = this.handlers.get(destination) ?? new Set<RealtimeHandler>();
    set.add(handler as RealtimeHandler);
    this.handlers.set(destination, set);
    return () => {
      set.delete(handler as RealtimeHandler);
    };
  }

  onStateChange(handler: (state: RealtimeState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  emit(destination: string, payload: unknown): void {
    const envelope: RealtimeEnvelope = { destination, payload };
    for (const handler of this.handlers.get(destination) ?? []) {
      handler(payload, envelope);
    }
  }
}
