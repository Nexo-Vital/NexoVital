package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import java.util.UUID;

/**
 * Body of {@code POST /api/v1/solicitudes}. {@code ubicacion} is the pickup
 * point and the ONLY mandatory field; {@code emergenciaId}, {@code centroAyudaId}
 * and {@code zonaId} are optional context, because a citizen request no longer
 * depends on an affected zone. Fields are validated by the controller, not by
 * bean validation: this repository has no {@code @ControllerAdvice}, so a binding
 * failure would not produce the {@code {codigo, mensaje}} envelope.
 *
 * <p>There is no deadline field (EP-04.F2.US6): the server alone decides until
 * when a request can be answered. A client that still sends {@code timeoutEn}
 * is not rejected; the unknown property is ignored.
 *
 * @param ubicacion  pickup point {lat, lng}; required and finite
 */
public record SolicitudRequest(UbicacionDto ubicacion, UUID emergenciaId, UUID centroAyudaId,
                               String zonaId) {
}
