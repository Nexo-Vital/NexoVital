package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Read model of the fleet with position and state (AC5). */
public interface ConsultarFlotaUseCase {

    List<Ambulancia> consultarFlota();

    /**
     * The authenticated driver's OWN unit, or empty when they drive none. It is
     * the server-scoped read that replaces resolving the unit from the general
     * fleet list (which no longer exposes any driver id).
     */
    Optional<Ambulancia> consultarPropia(UUID conductorId);
}
