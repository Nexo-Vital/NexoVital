package co.edu.escuelaing.nexovital.mapa.domain.port.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;

import java.util.List;

/**
 * Output port towards the {@code recursos} module: the map reads the active
 * shortage alerts through this port and never with a {@code SELECT} to its
 * schema (data boundary, ADR-0003).
 *
 * <p>It mirrors {@link CentroMapaQueryPort}: an adapter of {@code mapa}
 * satisfies it by delegating to the public input port of {@code recursos}
 * ({@code ConsultarAlertasEscasezUseCase}), not to its repository. The read
 * model {@link AlertaEscasezActiva} already carries the missing quantity
 * computed against the current stock, so {@code mapa} never reads inventory.
 */
public interface AlertasEscasezQueryPort {

    /**
     * @return every active alert, with its current missing quantity
     */
    List<AlertaEscasezActiva> listarActivas();
}
