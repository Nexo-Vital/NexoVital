package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AmbulanciaJpaRepository extends JpaRepository<AmbulanciaJpaEntity, UUID> {

    Optional<AmbulanciaJpaEntity> findByPlaca(String placa);

    List<AmbulanciaJpaEntity> findByEstadoAndZona(EstadoAmbulancia estado, String zona);

    /**
     * The unit driven by a user. {@code findFirst} because the invariant is one
     * unit per driver (D-F6): a driver with several rows is a data anomaly and
     * must not turn the read into a 500.
     */
    Optional<AmbulanciaJpaEntity> findFirstByConductorId(UUID conductorId);
}
