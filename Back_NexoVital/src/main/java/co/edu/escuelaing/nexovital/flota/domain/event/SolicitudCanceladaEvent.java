package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.List;
import java.util.UUID;

/**
 * The requester withdrew the request before any unit accepted it
 * (PENDIENTE → CANCELADA). Published inside the cancellation transaction; the
 * post-commit listener tells the requester and every notified unit, so the
 * stale card disappears from their inbox.
 *
 * <p>Cancellation is about the request as a whole, so no notified unit was ever
 * occupied (only the winner of an accept enters a mission) and all of them keep
 * their state.
 */
public record SolicitudCanceladaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                      List<UUID> ambulanciasNotificadas, UUID solicitanteId) {
}
