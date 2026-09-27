package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Body of {@code POST /api/v1/solicitudes}. Optional fields are validated by
 * the controller, not by bean validation: this repository has no
 * {@code @ControllerAdvice}, so a binding failure would not produce the
 * {@code {codigo, mensaje}} envelope.
 *
 * @param timeoutEn optional client-supplied accept deadline; the service falls
 *                  back to its configured window when absent
 */
public record SolicitudRequest(UUID emergenciaId, UUID centroAyudaId, String zonaId, Instant timeoutEn) {
}
