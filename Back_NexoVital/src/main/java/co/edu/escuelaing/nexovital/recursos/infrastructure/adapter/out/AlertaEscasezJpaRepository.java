package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository of the shortage alerts.
 *
 * <p>There is one row per item of a center (unique constraint in
 * {@link AlertaEscasezJpaEntity}). The two updates below are single conditional
 * statements, the same idea as the dispatch CAS: the comparison and the write
 * happen in ONE statement, so two concurrent rejections cannot read the same
 * value and overwrite each other.
 */
public interface AlertaEscasezJpaRepository extends JpaRepository<AlertaEscasezJpaEntity, UUID> {

    List<AlertaEscasezJpaEntity> findByCentroAcopioIdAndItemIdOrderByCantidadSolicitadaDesc(UUID centroAcopioId,
                                                                                           UUID itemId);

    /**
     * FA-4 as one statement: raises the demand only when the new one is larger.
     *
     * @return 1 when the demand was raised, 0 when the row already held a
     *         same-or-larger demand
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE AlertaEscasezJpaEntity a
               SET a.cantidadSolicitada = :nuevaDemanda
             WHERE a.id = :id
               AND a.cantidadSolicitada < :nuevaDemanda
            """)
    int subirDemandaSiEsMayor(@Param("id") UUID id, @Param("nuevaDemanda") int nuevaDemanda);

    /**
     * Opens a new shortage cycle on a covered alert, only if nobody changed it
     * since it was read (compare-and-set on the demand that was read).
     *
     * @return 1 when this caller opened the cycle, 0 when another one got there first
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE AlertaEscasezJpaEntity a
               SET a.cantidadSolicitada = :nuevaDemanda,
                   a.creadaEn = :ahora
             WHERE a.id = :id
               AND a.cantidadSolicitada = :demandaLeida
            """)
    int reactivarSiNoCambio(@Param("id") UUID id,
                            @Param("demandaLeida") int demandaLeida,
                            @Param("nuevaDemanda") int nuevaDemanda,
                            @Param("ahora") Instant ahora);
}
