package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/** The driver tries to finish a service the citizen has not confirmed yet. */
public class ConfirmacionPendienteException extends RuntimeException {

    public ConfirmacionPendienteException(UUID solicitudId) {
        super("Request " + solicitudId + " is waiting for the citizen's confirmation");
    }
}
