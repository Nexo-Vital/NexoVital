package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * No request exists with the given id. The controller translates it to
 * {@code 404 SOLICITUD_NO_ENCONTRADA}.
 */
public class SolicitudNoEncontradaException extends RuntimeException {

    public SolicitudNoEncontradaException(UUID id) {
        super("Ambulance request not found: " + id);
    }
}
