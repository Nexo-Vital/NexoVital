package co.edu.escuelaing.nexovital.flota.domain.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The accept window of a still-PENDIENTE request closed with no winner and the
 * sweep re-emitted it to the currently available units (EP-04.F2.US4). Published
 * inside the retry transaction; the post-commit listener fans out the SAME
 * {@code PENDIENTE} payload as {@link SolicitudCreadaEvent}, mirroring the
 * creation broadcast.
 *
 * <p><b>No zone/radio filter (documented deviation).</b> The repo notifies EVERY
 * available unit by design, so "widen the search radius" is delivered as
 * re-emitting to the units available at retry time. The requester is told too, so
 * their screen keeps tracking the still-open request instead of believing the
 * window was lost.
 *
 * @param reintento the retry ordinal (1 for the first retry), useful for logging
 */
public record SolicitudReintentadaEvent(UUID solicitudId, double lat, double lng, UUID emergenciaId,
                                        String zonaId, List<UUID> ambulanciasNotificadas,
                                        Instant timeoutEn, int reintento, UUID solicitanteId) {
}
