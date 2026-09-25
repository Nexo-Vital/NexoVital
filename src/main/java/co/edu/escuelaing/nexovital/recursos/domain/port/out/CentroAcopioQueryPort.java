package co.edu.escuelaing.nexovital.recursos.domain.port.out;

import java.util.UUID;

/**
 * Output port towards the {@code usuarios} module: {@code recursos} checks
 * whether a center exists through this port and never with a {@code SELECT} to
 * its schema (data boundary, ADR-0003).
 *
 * <p>An adapter of {@code recursos} satisfies it by delegating to the public
 * use case of {@code usuarios} ({@code ListarOrganizacionesUseCase}), not to
 * its repository: the design mandates reading through the owner's port.
 */
public interface CentroAcopioQueryPort {

    /**
     * @param centroAcopioId id of the organization
     * @return {@code true} when an organization with that id exists
     */
    boolean existe(UUID centroAcopioId);
}
