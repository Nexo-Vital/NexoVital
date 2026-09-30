package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;

import java.util.UUID;

/**
 * First accept wins the CAS; the rest lose (AC2).
 *
 * <p>The accepting unit is only valid when it was notified for the request and
 * when it is the unit driven by the authenticated user, so {@code conductorId}
 * carries the principal the controller resolved.
 */
public interface AceptarSolicitudUseCase {

    ResultadoAceptarSolicitud aceptar(UUID solicitudId, UUID ambulanciaId, UUID conductorId);
}
