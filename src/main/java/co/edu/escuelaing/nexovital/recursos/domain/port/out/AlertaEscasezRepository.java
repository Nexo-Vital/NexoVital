package co.edu.escuelaing.nexovital.recursos.domain.port.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Output port: persistence of shortage alerts. Returns the domain model
 * {@link AlertaEscasez}, never the JPA entity.
 *
 * <p>The owner writes through this port from its own transaction (FA-6): the
 * rejected dispatch commits the alert before rolling back, so the alert must
 * be persisted outside the dispatch transaction.
 */
public interface AlertaEscasezRepository {

    /**
     * The live record for one item of one center. When concurrency left more
     * than one row, the one holding the largest demand is returned: it is the
     * demand that must not be lowered (FA-4).
     *
     * @param centroAcopioId id of the center
     * @param itemId         id of the item
     * @return the record with the largest demand, or empty when none exists
     */
    Optional<AlertaEscasez> buscarMayorDemanda(UUID centroAcopioId, UUID itemId);

    /**
     * Inserts or updates the alert (same id updates, new id inserts).
     *
     * @param alerta alert to persist
     * @return the persisted alert
     */
    AlertaEscasez guardar(AlertaEscasez alerta);

    /**
     * @return every alert of every center, for the map read-model
     */
    List<AlertaEscasez> listarTodas();
}
