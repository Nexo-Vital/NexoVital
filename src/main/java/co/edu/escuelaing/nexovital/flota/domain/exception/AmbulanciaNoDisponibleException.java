package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * No available ambulance can take the request: either there is NO available unit
 * at all, or the given unit is not {@code DISPONIBLE}. The controller translates
 * it to {@code 409 AMBULANCIA_NO_DISPONIBLE}.
 *
 * <p>The unit variant is used by the lifecycle commands (accept/reject/arrival/
 * finish/position) when the addressed unit is missing or already busy. The no-arg
 * variant is used by the broadcast when the fleet has no available unit: the
 * request no longer depends on a zone, so the message never mentions one.
 *
 * <p>It extends {@link RuntimeException} (not Spring, not JPA): the module owns
 * the meaning, mirroring the not-found exceptions of {@code mapa}/{@code recursos}.
 */
public class AmbulanciaNoDisponibleException extends RuntimeException {

    public AmbulanciaNoDisponibleException(UUID id) {
        super("Ambulance not available: " + id);
    }

    /** No unit at all is available for a new broadcast request. */
    public AmbulanciaNoDisponibleException() {
        super("No available ambulances");
    }
}
