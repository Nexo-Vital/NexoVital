package co.edu.escuelaing.nexovital.flota.domain.event;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;

import java.time.Instant;
import java.util.UUID;

/**
 * The position feed of a unit changed: it reported a new position, or it lost
 * its signal. Published AFTER the change is persisted (never inside the write)
 * and projected to {@code /topic/flota} with the shape the front consumes.
 *
 * <p>It carries the unit's {@code estado} as it is at write time and is NEVER
 * changed by the report: position is data, state is a different concern (D-T5).
 * {@code heading} is a transient telemetry hint (degrees clockwise from north),
 * not persisted by the domain.
 *
 * <p><b>Signal (EP-04.F1.US1, D4).</b> {@code sinSenal} is {@code false} on a
 * position report and {@code true} on the signal-loss notice, which carries the
 * LAST known position. {@code ultimaPosicionEn} is the instant of the last
 * accepted report.
 *
 * <p><b>Order (D6).</b> {@code version} is the row version read inside the same
 * transaction that wrote. The push happens after commit, each one on its own
 * thread, so two writes on the same unit can reach the channel inverted; the
 * consumer discards any frame older than the one it already holds.
 */
public record PosicionActualizadaEvent(UUID ambulanciaId, double lat, double lng,
                                       EstadoAmbulancia estado, Integer heading,
                                       FuentePosicion fuente, boolean sinSenal,
                                       Instant ultimaPosicionEn, long version) {
}
