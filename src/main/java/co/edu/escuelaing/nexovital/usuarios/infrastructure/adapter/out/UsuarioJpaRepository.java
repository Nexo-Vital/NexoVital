package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface UsuarioJpaRepository extends JpaRepository<UsuarioJpaEntity, UUID> {

    Optional<UsuarioJpaEntity> findByEmail(String email);

    boolean existsByEmail(String email);

    /**
     * Incrementa el contador de fallos y dispara el bloqueo en <b>una sola</b>
     * sentencia (diseño D6). En SQL, las expresiones del {@code SET} leen el
     * valor previo de la fila: {@code u.intentosFallidos + 1} es el valor que
     * tendrá el contador tras este fallo.
     *
     * <p>Atomicidad: dos intentos concurrentes sobre la misma cuenta no pueden
     * perder incrementos, y {@code bloqueadoHasta} no se fija antes del fallo
     * número {@code maxIntentos}. No hay lectura-modificación-escritura en Java.
     *
     * {@code clearAutomatically} descarta el contexto de persistencia tras el
     * UPDATE y {@code flushAutomatically} vuelca los cambios pendientes antes,
     * para que la lectura posterior del adaptador vea el valor real.
     *
     * @param usuarioId   cuenta afectada
     * @param limite      instante hasta el cual bloquear si se alcanza el máximo
     * @param maxIntentos fallos consecutivos que disparan el bloqueo
     * @return filas afectadas (1 = actualizada, 0 = la cuenta no existe)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE UsuarioJpaEntity u "
            + "SET u.intentosFallidos = u.intentosFallidos + 1, "
            + "    u.bloqueadoHasta = CASE WHEN u.intentosFallidos + 1 >= :maxIntentos "
            + "                            THEN :limite ELSE u.bloqueadoHasta END "
            + "WHERE u.id = :usuarioId")
    int registrarIntentoFallido(@Param("usuarioId") UUID usuarioId,
                                @Param("limite") Instant limite,
                                @Param("maxIntentos") int maxIntentos);

    /**
     * Deja la cuenta sin bloqueo y con el contador en cero (login exitoso o
     * ventana de bloqueo expirada, diseño D5).
     *
     * @return filas afectadas (1 = actualizada, 0 = la cuenta no existe)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE UsuarioJpaEntity u "
            + "SET u.intentosFallidos = 0, u.bloqueadoHasta = NULL "
            + "WHERE u.id = :usuarioId")
    int reiniciarIntentos(@Param("usuarioId") UUID usuarioId);
}
