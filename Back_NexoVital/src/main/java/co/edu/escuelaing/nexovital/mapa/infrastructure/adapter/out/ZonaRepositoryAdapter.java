package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ZonaRepositoryAdapter implements ZonaRepository {

    private final ZonaJpaRepository jpaRepository;

    public ZonaRepositoryAdapter(ZonaJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public List<Zona> listar() {
        return jpaRepository.findAllByOrderByNombreAsc().stream()
                .map(ZonaRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public boolean existePorId(String id) {
        return jpaRepository.existsById(id);
    }

    @Override
    public Zona guardar(Zona zona) {
        ZonaJpaEntity entity = new ZonaJpaEntity(
                zona.getId(),
                zona.getNombre(),
                zona.getUbicacion().lat(),
                zona.getUbicacion().lng(),
                zona.getContorno().stream()
                        .map(vertice -> new VerticeZonaJpa(vertice.lat(), vertice.lng()))
                        .toList());
        return toDomain(jpaRepository.save(entity));
    }

    private static Zona toDomain(ZonaJpaEntity entity) {
        return new Zona(
                entity.getId(),
                entity.getNombre(),
                new Ubicacion(entity.getLat(), entity.getLng()),
                entity.getContorno().stream()
                        .map(vertice -> new Ubicacion(vertice.getLat(), vertice.getLng()))
                        .toList());
    }
}
