package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The authenticated driver asks for the detail of a request that was neither
 * notified nor assigned to their unit (EP-04.F2.US3). It is an authorization
 * refusal, so the controller translates it to
 * {@code 403 SOLICITUD_NO_NOTIFICADA}.
 */
public class SolicitudNoNotificadaException extends RuntimeException {

    public SolicitudNoNotificadaException(UUID solicitudId, UUID conductorId) {
        super("Request " + solicitudId + " was not notified to the unit of driver " + conductorId);
    }
}
