package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence adapter for the fleet. It translates between the {@link Ambulancia}
 * aggregate and the JPA entity; the domain never sees JPA. It satisfies both the
 * write port and the read port.
 */
@Component
public class AmbulanciaRepositoryAdapter implements AmbulanciaRepository, FlotaQueryPort {

    private final AmbulanciaJpaRepository jpaRepository;

    public AmbulanciaRepositoryAdapter(AmbulanciaJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public List<Ambulancia> listarDisponiblesEnZona(String zona) {
        return jpaRepository.findByEstadoAndZona(EstadoAmbulancia.DISPONIBLE, zona).stream()
                .map(AmbulanciaRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public Optional<Ambulancia> buscarPorId(UUID id) {
        return jpaRepository.findById(id).map(AmbulanciaRepositoryAdapter::toDomain);
    }

    @Override
    public Ambulancia guardar(Ambulancia ambulancia) {
        AmbulanciaJpaEntity entity = new AmbulanciaJpaEntity(
                ambulancia.getId(), ambulancia.getPlaca(), ambulancia.getEstado(),
                ambulancia.getLat(), ambulancia.getLng(), ambulancia.getZona(),
                ambulancia.getConductorId());
        return toDomain(jpaRepository.save(entity));
    }

    @Override
    public void actualizarEstado(UUID id, EstadoAmbulancia estado) {
        jpaRepository.findById(id).ifPresent(entity -> {
            entity.setEstado(estado);
            jpaRepository.save(entity);
        });
    }

    @Override
    public List<Ambulancia> consultarFlota() {
        return jpaRepository.findAll().stream().map(AmbulanciaRepositoryAdapter::toDomain).toList();
    }

    private static Ambulancia toDomain(AmbulanciaJpaEntity entity) {
        return new Ambulancia(
                entity.getId(), entity.getPlaca(), entity.getEstado(),
                entity.getLat(), entity.getLng(), entity.getZona(),
                entity.getConductorId(), entity.getVersion());
    }
}
