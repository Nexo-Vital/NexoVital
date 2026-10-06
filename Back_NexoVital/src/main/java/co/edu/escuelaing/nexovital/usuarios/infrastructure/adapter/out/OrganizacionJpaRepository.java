package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OrganizacionJpaRepository extends JpaRepository<OrganizacionJpaEntity, UUID> {

    List<OrganizacionJpaEntity> findAllByOrderByNombreAsc();

    List<OrganizacionJpaEntity> findByTipoOrderByNombreAsc(TipoOrganizacion tipo);

    boolean existsByNombre(String nombre);

    Optional<OrganizacionJpaEntity> findByAdminId(UUID adminId);
}
