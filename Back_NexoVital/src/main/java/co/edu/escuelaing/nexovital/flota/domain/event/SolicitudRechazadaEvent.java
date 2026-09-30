package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * A unit declined the request. {@code ambulanciaId} identifies the declining
 * unit so the post-commit push reaches only its driver. The request stays
 * PENDIENTE for the other notified units (AC4).
 */
public record SolicitudRechazadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId, UUID ambulanciaId) {
}
