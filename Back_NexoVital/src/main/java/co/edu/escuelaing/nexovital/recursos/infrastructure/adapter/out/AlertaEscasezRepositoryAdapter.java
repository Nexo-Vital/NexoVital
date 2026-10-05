package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.AlertaEscasezRepository;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence adapter of the shortage alerts. Translates between the domain
 * model {@link AlertaEscasez} and the JPA entity; the domain never sees JPA.
 */
@Component
public class AlertaEscasezRepositoryAdapter implements AlertaEscasezRepository {

    private final AlertaEscasezJpaRepository jpaRepository;

    public AlertaEscasezRepositoryAdapter(AlertaEscasezJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public Optional<AlertaEscasez> buscarMayorDemanda(UUID centroAcopioId, UUID itemId) {
        return jpaRepository
                .findByCentroAcopioIdAndItemIdOrderByCantidadSolicitadaDesc(centroAcopioId, itemId)
                .stream()
                .findFirst()
                .map(AlertaEscasezRepositoryAdapter::toDomain);
    }

    @Override
    public AlertaEscasez crear(AlertaEscasez alerta) {
        // Flushed on purpose: the unique-constraint error must surface here,
        // inside the caller's attempt, and not later at commit.
        return toDomain(jpaRepository.saveAndFlush(toEntity(alerta)));
    }

    @Override
    public boolean subirDemandaSiEsMayor(UUID id, int nuevaDemanda) {
        return jpaRepository.subirDemandaSiEsMayor(id, nuevaDemanda) == 1;
    }

    @Override
    public boolean reactivarSiNoCambio(UUID id, int demandaLeida, int nuevaDemanda, Instant ahora) {
        return jpaRepository.reactivarSiNoCambio(id, demandaLeida, nuevaDemanda, ahora) == 1;
    }

    @Override
    public List<AlertaEscasez> listarTodas() {
        return jpaRepository.findAll().stream()
                .map(AlertaEscasezRepositoryAdapter::toDomain)
                .toList();
    }

    private static AlertaEscasezJpaEntity toEntity(AlertaEscasez alerta) {
        return new AlertaEscasezJpaEntity(
                alerta.getId(),
                alerta.getCentroAcopioId(),
                alerta.getItemId(),
                alerta.getNombre(),
                alerta.getCantidadSolicitada(),
                alerta.getCreadaEn());
    }

    private static AlertaEscasez toDomain(AlertaEscasezJpaEntity entity) {
        return new AlertaEscasez(
                entity.getId(),
                entity.getCentroAcopioId(),
                entity.getItemId(),
                entity.getNombre(),
                entity.getCantidadSolicitada(),
                entity.getCreadaEn());
    }
}
