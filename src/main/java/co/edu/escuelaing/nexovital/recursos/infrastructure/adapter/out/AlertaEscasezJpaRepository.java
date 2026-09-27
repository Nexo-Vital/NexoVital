package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository of the shortage alerts. Ordering by descending demand
 * is the query's decision, so
 * {@link co.edu.escuelaing.nexovital.recursos.domain.port.out.AlertaEscasezRepository#buscarMayorDemanda}
 * can take the first row: under a race there may be more than one row for the
 * same item, and the largest demand is the one that must win (FA-4).
 */
public interface AlertaEscasezJpaRepository extends JpaRepository<AlertaEscasezJpaEntity, UUID> {

    List<AlertaEscasezJpaEntity> findByCentroAcopioIdAndItemIdOrderByCantidadSolicitadaDesc(UUID centroAcopioId,
                                                                                           UUID itemId);
}
