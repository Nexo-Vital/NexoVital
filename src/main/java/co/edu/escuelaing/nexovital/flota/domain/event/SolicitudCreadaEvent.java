package co.edu.escuelaing.nexovital.flota.domain.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A new broadcast request was persisted. Published inside the transaction; the
 * post-commit listener fans it out to EVERY notified unit (D-F1, AC1).
 */
public record SolicitudCreadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                   List<UUID> ambulanciasNotificadas, Instant solicitadaEn) {
}
