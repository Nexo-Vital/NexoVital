package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ZonaJpaRepository extends JpaRepository<ZonaJpaEntity, String> {

    List<ZonaJpaEntity> findAllByOrderByNombreAsc();
}
