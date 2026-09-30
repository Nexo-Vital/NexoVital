package co.edu.escuelaing.nexovital.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Controllable clock for tests (design D8).
 *
 * <p>The 5-minute lockout window rule cannot be verified deterministically with
 * the system clock: the design made {@link Clock} injectable precisely for this.
 * Here the instant is fixed and advanced without sleeping the suite.
 *
 * <p>State is shared across the zone views returned by {@link #withZone(ZoneId)}
 * so that advancing one view advances the real clock seen by the use case.
 */
public final class MutableClock extends Clock {

    private final AtomicReference<Instant> instante;
    private final ZoneId zona;

    public MutableClock(Instant inicial) {
        this(new AtomicReference<>(inicial), ZoneOffset.UTC);
    }

    private MutableClock(AtomicReference<Instant> instante, ZoneId zona) {
        this.instante = instante;
        this.zona = zona;
    }

    @Override
    public ZoneId getZone() {
        return zona;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new MutableClock(instante, zone);
    }

    @Override
    public Instant instant() {
        return instante.get();
    }

    /** Sets the current instant of the clock. */
    public void fijar(Instant nuevo) {
        instante.set(nuevo);
    }

    /** Advances the current instant without sleeping the thread. */
    public void avanzar(Duration delta) {
        instante.updateAndGet(actual -> actual.plus(delta));
    }
}
