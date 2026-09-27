package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;

import java.util.List;

/**
 * Input port of {@code recursos}: the active shortage alerts, already joined
 * with the current stock so the consumer never has to read inventory.
 *
 * <p>This is the public port the {@code mapa} module calls through its own
 * cross-module adapter (FA-5). It is the mirror of {@code usuarios}'s
 * {@code ListarOrganizacionesUseCase}.
 */
public interface ConsultarAlertasEscasezUseCase {

    /**
     * @return every alert whose demand is still uncovered, with its current
     *         missing quantity
     */
    List<AlertaEscasezActiva> listarActivas();
}
