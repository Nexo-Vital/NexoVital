package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.Optional;
import java.util.UUID;

/**
 * The driver declares whether their OWN unit is available for requests
 * (EP-04.F2.US1): "Disponible" or "Fuera de servicio" in the driver console.
 *
 * <p>Only an available unit receives a new request, so the declaration has to
 * live on the server. The other two driver states ("En ruta", "En escena") are
 * never declared: they follow the request the unit accepted.
 *
 * <p>The unit is resolved from the authenticated driver, exactly as
 * {@code GET /api/v1/flota/ambulancias/mia}: the client never sends a unit id.
 */
public interface DeclararDisponibilidadUseCase {

    /**
     * Brings the unit back to service ({@code disponible = true}) or takes it
     * out of service ({@code false}). Repeatable: declaring the state the unit
     * already has changes nothing and publishes nothing.
     *
     * @return the unit as it is after the command, or empty when the driver
     *         drives no unit
     * @throws co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudEnCursoException
     *         if the unit is attending a request
     */
    Optional<Ambulancia> declarar(UUID conductorId, boolean disponible);
}
