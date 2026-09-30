package co.edu.escuelaing.nexovital.flota.domain.event;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;

import java.util.UUID;

/**
 * A unit reported a new position. Published AFTER the position is persisted
 * (never inside the write) and projected to {@code /topic/flota} with the shape
 * the front already consumes.
 *
 * <p>It carries the unit's {@code estado} as it is at report time and is NEVER
 * changed by the report: position is data, state is a different concern (D-T5).
 * {@code heading} is a transient telemetry hint (degrees clockwise from north),
 * not persisted by the domain.
 */
public record PosicionActualizadaEvent(UUID ambulanciaId, double lat, double lng,
                                       EstadoAmbulancia estado, Integer heading,
                                       FuentePosicion fuente) {
}
