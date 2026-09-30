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
     * Increments the failure counter and triggers the lockout in <b>a single</b>
     * statement (design D6). In SQL the {@code SET} expressions read the row's
     * previous value, so {@code u.intentosFallidos + 1} is what the counter will
     * hold after this failure.
     *
     * <p>Atomicity, three requirements: two concurrent attempts on the same
     * account must not lose increments; {@code bloqueadoHasta} must not be set
     * before failure number {@code maxIntentos}; and the counter must never
     * exceed {@code maxIntentos}.
     *
     * <p>The counter is clamped here on purpose. The Java-side pre-check cannot
     * make saturation atomic, so under real concurrency several in-flight requests
     * pass that check and all increment. Measured before the clamp: 5 parallel
     * failures left the counter at 5, violating invariants 1 and 2 of the model
     * (suite case T6). There is no read-modify-write in Java.
     *
     * {@code clearAutomatically} discards the persistence context after the UPDATE
     * and {@code flushAutomatically} flushes pending changes before it, so the
     * adapter's subsequent read observes the real value.
     *
     * @param usuarioId   affected account
     * @param limite      instant to block until, when the maximum is reached
     * @param maxIntentos consecutive failures that trigger the lockout
     * @return affected rows (1 = updated, 0 = the account does not exist)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE UsuarioJpaEntity u "
            + "SET u.intentosFallidos = CASE WHEN u.intentosFallidos + 1 >= :maxIntentos "
            + "                              THEN :maxIntentos ELSE u.intentosFallidos + 1 END, "
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
