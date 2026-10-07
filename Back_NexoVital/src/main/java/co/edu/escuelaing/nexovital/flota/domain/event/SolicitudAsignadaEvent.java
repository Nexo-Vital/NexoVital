package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.List;
import java.util.UUID;

/**
 * A unit won the accept CAS. Published post-commit to its driver and to the
 * requester, so the citizen sees the assignment of their own request.
 *
 * <p>{@code ambulanciasNotificadas} is the list the request was broadcast to. It
 * travels with the event so every OTHER notified unit can be told, at once, that
 * the request is no longer available (EP-04.F2.US4): without it a losing driver
 * kept the request on screen until its window ran out.
 */
public record SolicitudAsignadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                     UUID ambulanciaId, UUID solicitanteId,
                                     List<UUID> ambulanciasNotificadas) {

    public SolicitudAsignadaEvent {
        ambulanciasNotificadas = ambulanciasNotificadas == null
                ? List.of()
                : List.copyOf(ambulanciasNotificadas);
    }
}
