package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Body of {@code POST /api/v1/solicitudes}. {@code ubicacion} is the pickup
 * point and the ONLY mandatory field; {@code emergenciaId}, {@code centroAyudaId}
 * and {@code zonaId} are optional context, because a citizen request no longer
 * depends on an affected zone. Fields are validated by the controller, not by
 * bean validation: this repository has no {@code @ControllerAdvice}, so a binding
 * failure would not produce the {@code {codigo, mensaje}} envelope.
 *
 * @param ubicacion  pickup point {lat, lng}; required and finite
 * @param timeoutEn  optional client-supplied accept deadline; the service falls
 *                   back to its configured window when absent
 */
public record SolicitudRequest(UbicacionDto ubicacion, UUID emergenciaId, UUID centroAyudaId,
                               String zonaId, Instant timeoutEn) {
}
