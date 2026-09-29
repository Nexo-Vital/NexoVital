package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The authenticated caller is not the requester of the request they are trying
 * to act on (cancel). It is an authorization refusal, not a state conflict, so
 * the controller translates it to {@code 403 SOLICITUD_AJENA} instead of the
 * {@code 409} used for a transition the current state does not allow.
 */
public class SolicitudAjenaException extends RuntimeException {

    public SolicitudAjenaException(UUID id, UUID solicitanteId) {
        super("Request " + id + " does not belong to user " + solicitanteId);
    }
}
