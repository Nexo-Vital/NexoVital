package co.edu.escuelaing.nexovital.recursos.domain.port.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;

import java.time.Instant;
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
     * The record for one item of one center. There is at most one: the store
     * keeps a single row per {@code (center, item)}.
     *
     * @param centroAcopioId id of the center
     * @param itemId         id of the item
     * @return the record with the largest demand, or empty when none exists
     */
    Optional<AlertaEscasez> buscarMayorDemanda(UUID centroAcopioId, UUID itemId);

    /**
     * Inserts a brand-new alert and sends it to the store right away.
     *
     * <p>If another transaction already holds an alert for the same item of the
     * same center, this fails with the store's integrity error instead of
     * leaving a second row; the caller retries and finds the existing one.
     *
     * @param alerta alert to insert
     * @return the persisted alert
     */
    AlertaEscasez crear(AlertaEscasez alerta);

    /**
     * FA-4 in one atomic step: raises the recorded demand only when
     * {@code nuevaDemanda} is larger than the stored one. A smaller or equal
     * demand never lowers it, even under concurrent rejections.
     *
     * @param id           id of the alert
     * @param nuevaDemanda demand of the new rejection
     * @return {@code true} when the demand was raised
     */
    boolean subirDemandaSiEsMayor(UUID id, int nuevaDemanda);

    /**
     * Starts a new shortage cycle on an alert that was already covered, only if
     * its demand is still {@code demandaLeida} (compare-and-set).
     *
     * @param id           id of the alert
     * @param demandaLeida demand the caller read before deciding
     * @param nuevaDemanda demand of the new cycle
     * @param ahora        start of the new cycle
     * @return {@code true} when this caller opened the cycle; {@code false}
     *         when someone else changed the alert first and the caller must
     *         read it again
     */
    boolean reactivarSiNoCambio(UUID id, int demandaLeida, int nuevaDemanda, Instant ahora);

    /**
     * @return every alert of every center, for the map read-model
     */
    List<AlertaEscasez> listarTodas();
}
