package co.edu.escuelaing.nexovital.infrastructure.bloqueo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Acceso a los bloqueos de ejecución. Toda la exclusión mutua vive en un único
 * UPDATE condicional: es la base de datos la que decide quién gana, no la
 * aplicación. Un {@code SELECT} seguido de un {@code UPDATE} desde la aplicación
 * tendría la misma carrera que el seeder.
 */
public interface BloqueoEjecucionJpaRepository
        extends JpaRepository<BloqueoEjecucionJpaEntity, String> {

    /**
     * Toma o renueva el bloqueo si está libre, vencido, o ya es de este dueño.
     *
     * <p>La condición {@code expiraEn < ahora OR propietario = yo} es lo que
     * permite al dueño renovar sin soltar el bloqueo entre ciclos.
     *
     * @return 1 si el bloqueo quedó en manos de {@code propietario}; 0 si lo
     *         tiene otra instancia y sigue vigente
     */
    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update BloqueoEjecucionJpaEntity b "
            + "set b.propietario = :propietario, b.expiraEn = :expiraEn "
            + "where b.nombre = :nombre "
            + "and (b.expiraEn < :ahora or b.propietario = :propietario)")
    int tomar(
            @Param("nombre") String nombre,
            @Param("propietario") String propietario,
            @Param("expiraEn") Instant expiraEn,
            @Param("ahora") Instant ahora);
}
