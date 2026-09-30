package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * The service is attended and the driver finished it: the request closes and
 * the assigned unit is released (EP-04.F2.US6/US11). Published post-commit so
 * the assigned driver and the requester see the closure, and the fleet feed
 * announces the unit back to {@code DISPONIBLE}.
 */
public record SolicitudFinalizadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                       UUID ambulanciaId, UUID solicitanteId) {
}
