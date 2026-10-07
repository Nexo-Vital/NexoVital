package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * A unit connected to the service or disconnected from it (EP-04.F2.US1, D2).
 * Published to {@code /topic/flota} after commit. The event carries only the
 * identity: the listener reads the row, so the frame is always a consistent
 * snapshot of {@code conectada} and its {@code version}.
 */
public record ConexionUnidadEvent(UUID ambulanciaId) {
}
