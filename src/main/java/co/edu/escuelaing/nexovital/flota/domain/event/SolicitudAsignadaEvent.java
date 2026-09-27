package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * A unit won the accept CAS. Published post-commit to its driver and to the
 * requester, so the citizen sees the assignment of their own request.
 */
public record SolicitudAsignadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                     UUID ambulanciaId, UUID solicitanteId) {
}
