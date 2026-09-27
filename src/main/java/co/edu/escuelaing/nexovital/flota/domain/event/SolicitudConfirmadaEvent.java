package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/** The help center confirmed the assigned unit. Published post-commit. */
public record SolicitudConfirmadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId, UUID ambulanciaId) {
}
