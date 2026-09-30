package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.List;
import java.util.UUID;

/**
 * The request expired without an accept (PENDIENTE → TIMEOUT, EP-04.F2.US9).
 * Published inside the expiry transaction; the post-commit listener tells the
 * requester and the notified units, whose notification window closed.
 *
 * <p>Expiry is about the request as a whole, not a per-unit countdown: the
 * single {@code timeoutEn} window closed without a winner, so every notified
 * unit is released at once (they were never occupied: only the winner of an
 * accept enters a mission).
 */
public record SolicitudExpiradaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                     List<UUID> ambulanciasNotificadas, UUID solicitanteId) {
}
