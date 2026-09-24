package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface EmergenciaJpaRepository extends JpaRepository<EmergenciaJpaEntity, UUID> {
}
