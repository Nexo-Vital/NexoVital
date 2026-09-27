package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * A unit declines the request. The request stays PENDIENTE so the other
 * notified units can still accept it (AC4).
 *
 * <p>The accepting unit is only valid when it was notified for the request and
 * when it is the unit driven by the authenticated user, so {@code conductorId}
 * carries the principal the controller resolved.
 */
public interface RechazarSolicitudUseCase {

    SolicitudAmbulancia rechazar(UUID solicitudId, UUID ambulanciaId, UUID conductorId);
}
