package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The citizen tries to confirm, or the driver tries to finish, a service whose
 * unit has not declared its arrival yet (EP-04.F2.US8, M-04). The arrival is
 * the milestone both steps depend on: confirming first used to leave the
 * arrival undeclarable forever, and finishing first closed a service with no
 * arrival time. The controller translates it to
 * {@code 409 LLEGADA_NO_DECLARADA}.
 *
 * <p>It is deliberately NOT a {@link SolicitudNoAsignableException}: the
 * request is still in service, it only needs the arrival first.
 */
public class LlegadaNoDeclaradaException extends RuntimeException {

    public LlegadaNoDeclaradaException(UUID solicitudId) {
        super("Request " + solicitudId + " has no declared arrival yet");
    }
}
