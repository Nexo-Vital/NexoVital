package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.OrganizacionRepository;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class OrganizacionRepositoryAdapter implements OrganizacionRepository {

    private final OrganizacionJpaRepository jpaRepository;

    public OrganizacionRepositoryAdapter(OrganizacionJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public List<Organizacion> listar(TipoOrganizacion tipo) {
        List<OrganizacionJpaEntity> entidades = (tipo == null)
                ? jpaRepository.findAllByOrderByNombreAsc()
                : jpaRepository.findByTipoOrderByNombreAsc(tipo);
        return entidades.stream().map(OrganizacionRepositoryAdapter::toDomain).toList();
    }

    @Override
    public boolean existePorNombre(String nombre) {
        return jpaRepository.existsByNombre(nombre);
    }

    @Override
    public Organizacion guardar(Organizacion organizacion) {
        OrganizacionJpaEntity entity = new OrganizacionJpaEntity(
                organizacion.getId(),
                organizacion.getNombre(),
                organizacion.getTipo(),
                organizacion.getZonaId(),
                organizacion.getUbicacion().lat(),
                organizacion.getUbicacion().lng());
        return toDomain(jpaRepository.save(entity));
    }

    private static Organizacion toDomain(OrganizacionJpaEntity entity) {
        return new Organizacion(
                entity.getId(),
                entity.getNombre(),
                entity.getTipo(),
                entity.getZonaId(),
                new Ubicacion(entity.getLat(), entity.getLng()));
    }
}
