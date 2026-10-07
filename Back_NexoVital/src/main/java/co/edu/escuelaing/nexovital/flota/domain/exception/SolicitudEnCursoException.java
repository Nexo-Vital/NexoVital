package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The driver tried to disconnect a unit that is attending a request
 * (EP-04.F2.US1, D3): a unit in service stays connected until the service is
 * finished. The controller translates it to {@code 409 SOLICITUD_EN_CURSO}.
 */
public class SolicitudEnCursoException extends RuntimeException {

    public SolicitudEnCursoException(UUID ambulanciaId) {
        super("Ambulance " + ambulanciaId + " is attending a request and cannot be disconnected");
    }
}
