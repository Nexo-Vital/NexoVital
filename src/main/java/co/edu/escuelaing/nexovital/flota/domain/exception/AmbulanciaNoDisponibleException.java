package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * No available ambulance can take the request: either the given unit is not
 * {@code DISPONIBLE} or its zone has no available units. The controller
 * translates it to {@code 409 AMBULANCIA_NO_DISPONIBLE}.
 *
 * <p>It extends {@link RuntimeException} (not Spring, not JPA): the module owns
 * the meaning, mirroring the not-found exceptions of {@code mapa}/{@code recursos}.
 */
public class AmbulanciaNoDisponibleException extends RuntimeException {

    public AmbulanciaNoDisponibleException(UUID id) {
        super("Ambulance not available: " + id);
    }

    public AmbulanciaNoDisponibleException(String zonaId) {
        super("No available ambulances in zone: " + zonaId);
    }
}
