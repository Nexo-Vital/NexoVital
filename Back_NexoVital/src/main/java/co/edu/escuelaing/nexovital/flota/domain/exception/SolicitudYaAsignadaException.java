package co.edu.escuelaing.nexovital.flota.domain.exception;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;

import java.util.UUID;

/**
 * A unit that was notified of the request tries to accept it when ANOTHER unit
 * already has it (EP-04.F2.US4): the accept arrived after the winner committed.
 *
 * <p>It is a {@link SolicitudNoAsignableException}, so every caller that treats
 * "the request no longer accepts that transition" keeps working and the answer
 * is still a {@code 409}. The subtype only lets the controller tell the driver
 * the reason the story asks for: the request is already assigned.
 */
public class SolicitudYaAsignadaException extends SolicitudNoAsignableException {

    public SolicitudYaAsignadaException(UUID id, EstadoSolicitud estado) {
        super(id, estado);
    }
}
