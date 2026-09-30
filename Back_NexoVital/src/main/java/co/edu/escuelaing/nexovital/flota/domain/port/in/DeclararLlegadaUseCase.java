package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * The winning unit declares it arrived at the scene.
 *
 * <p>Idempotent: declaring arrival again on a request whose arrival is already
 * recorded is a no-op that returns the current request. The unit must be the
 * one assigned to the request and must belong to the authenticated driver, so a
 * driver cannot declare an arrival on another unit's mission.
 */
public interface DeclararLlegadaUseCase {

    SolicitudAmbulancia declararLlegada(UUID solicitudId, UUID ambulanciaId, UUID conductorId);
}
