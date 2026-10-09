package co.edu.escuelaing.nexovital.flota.domain.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A new broadcast request was persisted. Published inside the transaction; the
 * post-commit listener fans it out to EVERY notified unit (D-F1, AC1) and to
 * the requester's own user queue.
 *
 * <p>Carries the pickup point ({@code lat}/{@code lng}) so the driver push can
 * show where to go: the request no longer depends on an emergency whose location
 * the front could resolve, so the location travels with the request itself.
 *
 * <p>Carries the two instants of the accept window, {@code solicitadaEn} and
 * {@code timeoutEn}, so the push can tell every driver when the request really
 * expires instead of leaving each console to assume a window of its own.
 */
public record SolicitudCreadaEvent(UUID solicitudId, double lat, double lng, UUID emergenciaId,
                                   String zonaId, List<UUID> ambulanciasNotificadas, Instant solicitadaEn,
                                   UUID solicitanteId, Instant timeoutEn, String direccion) {

    /** A request created without a readable address. */
    public SolicitudCreadaEvent(UUID solicitudId, double lat, double lng, UUID emergenciaId, String zonaId,
                                List<UUID> ambulanciasNotificadas, Instant solicitadaEn, UUID solicitanteId,
                                Instant timeoutEn) {
        this(solicitudId, lat, lng, emergenciaId, zonaId, ambulanciasNotificadas, solicitadaEn, solicitanteId,
                timeoutEn, null);
    }
}
