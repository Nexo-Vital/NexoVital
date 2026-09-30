package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface EmergenciaJpaRepository extends JpaRepository<EmergenciaJpaEntity, UUID> {

    /**
     * Registro del mapa: la emergencia más reciente primero. El orden es una
     * decisión de la consulta, no del consumidor.
     */
    List<EmergenciaJpaEntity> findAllByOrderByCreatedAtDesc();
}
