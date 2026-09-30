package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * The help center confirmed the assigned unit. Published post-commit to the
 * assigned driver and to the requester, so the citizen closes their own loop.
 */
public record SolicitudConfirmadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                       UUID ambulanciaId, UUID solicitanteId) {
}
