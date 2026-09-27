package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * A unit declines the request. The request stays PENDIENTE so the other
 * notified units can still accept it (AC4).
 */
public interface RechazarSolicitudUseCase {

    SolicitudAmbulancia rechazar(UUID solicitudId, UUID ambulanciaId);
}
