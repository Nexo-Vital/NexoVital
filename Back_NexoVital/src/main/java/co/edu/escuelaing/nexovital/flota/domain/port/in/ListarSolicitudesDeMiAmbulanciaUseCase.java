package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.List;
import java.util.UUID;

/**
 * Read model of the authenticated driver's OWN unit history: the services its
 * ambulance actually attended. The inbound adapter resolves the driver's unit
 * exactly as {@code GET /api/v1/flota/ambulancias/mia} (same use case/port) and
 * passes its id here, so the unit is never guessed from client input.
 */
public interface ListarSolicitudesDeMiAmbulanciaUseCase {

    /**
     * Services ASSIGNED to {@code ambulanciaId}, newest first. A request that
     * was only broadcast never appears: it has no assigned unit.
     *
     * @param ambulanciaId the caller's OWN unit, already resolved server-side
     */
    List<SolicitudAmbulancia> listar(UUID ambulanciaId);
}
