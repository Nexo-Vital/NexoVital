package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Repositorio Spring Data de la bitácora.
 *
 * <p>Hereda de {@link JpaRepository} y por eso arrastra {@code delete} y
 * {@code save} de actualización. La bitácora no los usa: la aplicación nunca
 * llama a esos métodos y la API no expone rutas que lleguen a ellos. Si se
 * quiere garantía a nivel de base, la siguiente parada es un trigger
 * {@code BEFORE UPDATE OR DELETE}; hoy la garantía es de uso, no de motor, y así
 * está documentado.
 */
public interface EventoAuditoriaJpaRepository extends JpaRepository<EventoAuditoriaJpaEntity, UUID> {

    List<EventoAuditoriaJpaEntity> findByRecursoTipoAndRecursoIdOrderByOcurridoEnAsc(
            String recursoTipo, UUID recursoId);
}
