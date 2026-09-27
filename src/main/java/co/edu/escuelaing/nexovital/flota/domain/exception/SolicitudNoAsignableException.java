package co.edu.escuelaing.nexovital.flota.domain.exception;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;

import java.util.UUID;

/**
 * The request is not in the state the transition requires (a lost CAS, an
 * already assigned request, a confirm over a non-ASSIGNED request). The
 * controller translates it to {@code 409}.
 */
public class SolicitudNoAsignableException extends RuntimeException {

    public SolicitudNoAsignableException(UUID id, EstadoSolicitud estado) {
        super("Request " + id + " is in state " + estado + " and does not accept that transition");
    }
}
