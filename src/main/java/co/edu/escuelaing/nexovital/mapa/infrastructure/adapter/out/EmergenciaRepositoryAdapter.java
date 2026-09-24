package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.EmergenciaRepository;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.springframework.stereotype.Component;

/**
 * Adaptador de persistencia de emergencias. Traduce entre el agregado de dominio
 * {@link Emergencia} y la entidad JPA; el dominio nunca ve JPA.
 */
@Component
public class EmergenciaRepositoryAdapter implements EmergenciaRepository {

    private final EmergenciaJpaRepository jpaRepository;

    public EmergenciaRepositoryAdapter(EmergenciaJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public Emergencia guardar(Emergencia emergencia) {
        EmergenciaJpaEntity entity = new EmergenciaJpaEntity(
                emergencia.getId(),
                emergencia.getUbicacion().lat(),
                emergencia.getUbicacion().lng(),
                emergencia.getNivel(),
                emergencia.getEstado(),
                emergencia.getDescripcion(),
                emergencia.getZonaId(),
                emergencia.getCreatedAt());
        return toDomain(jpaRepository.save(entity));
    }

    private static Emergencia toDomain(EmergenciaJpaEntity entity) {
        return new Emergencia(
                entity.getId(),
                new Ubicacion(entity.getUbicacionLat(), entity.getUbicacionLng()),
                entity.getNivel(),
                entity.getEstado(),
                entity.getDescripcion(),
                entity.getZonaId(),
                entity.getCreatedAt());
    }
}
