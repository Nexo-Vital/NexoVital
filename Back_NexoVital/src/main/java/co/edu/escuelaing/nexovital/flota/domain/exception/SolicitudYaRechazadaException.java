package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The unit tries to accept a request it already declined (EP-04.F2.US5). A
 * decline is final for that unit and that request: the request stays open for
 * the other notified units, but not for the one that said no. The controller
 * translates it to {@code 409 SOLICITUD_YA_RECHAZADA}.
 *
 * <p>It is deliberately NOT a {@link SolicitudNoAsignableException}: the request
 * is still assignable, just not to this unit, and the console must not read it
 * as "another ambulance took it".
 */
public class SolicitudYaRechazadaException extends RuntimeException {

    public SolicitudYaRechazadaException(UUID solicitudId, UUID ambulanciaId) {
        super("Unit " + ambulanciaId + " already declined request " + solicitudId);
    }
}
