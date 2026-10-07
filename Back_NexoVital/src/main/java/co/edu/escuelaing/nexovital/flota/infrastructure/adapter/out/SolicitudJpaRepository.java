package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface SolicitudJpaRepository extends JpaRepository<SolicitudJpaEntity, UUID> {

    /**
     * Real CAS of the C2 broadcast: a single UPDATE conditioned on the expected
     * state. Returns affected rows (1 = won, 0 = lost the race). The
     * {@code WHERE s.estado = :estadoEsperado} turns check-and-set into atomic:
     * two threads that both read PENDIENTE can never both win.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE SolicitudJpaEntity s "
            + "SET s.estado = :nuevoEstado, s.ambulanciaAsignadaId = :ambulanciaId, s.version = s.version + 1 "
            + "WHERE s.id = :id AND s.estado = :estadoEsperado")
    int transicionAtomicaAsignar(@Param("id") UUID id,
                                 @Param("ambulanciaId") UUID ambulanciaId,
                                 @Param("estadoEsperado") EstadoSolicitud estadoEsperado,
                                 @Param("nuevoEstado") EstadoSolicitud nuevoEstado);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE SolicitudJpaEntity s "
            + "SET s.estado = :nuevoEstado, s.version = s.version + 1 "
            + "WHERE s.id = :id AND s.estado = :estadoEsperado")
    int transicionAtomicaEstado(@Param("id") UUID id,
                                @Param("estadoEsperado") EstadoSolicitud estadoEsperado,
                                @Param("nuevoEstado") EstadoSolicitud nuevoEstado);

    /**
     * Idempotent arrival milestone: a single UPDATE that only writes the instant
     * if no arrival was recorded yet. Returns affected rows (1 = this call
     * recorded the arrival, 0 = another call already did). The
     * {@code WHERE s.llegadaEn IS NULL} turns check-and-set into atomic, so two
     * simultaneous declarations cannot both emit the arrival event.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE SolicitudJpaEntity s "
            + "SET s.llegadaEn = :llegadaEn, s.version = s.version + 1 "
            + "WHERE s.id = :id AND s.llegadaEn IS NULL")
    int transicionAtomicaLlegada(@Param("id") UUID id, @Param("llegadaEn") Instant llegadaEn);

    /**
     * Cierre del servicio: UNA sola {@code UPDATE} que mueve la solicitud al
     * estado terminal solo si sigue en servicio ({@code ASIGNADA} o
     * {@code CONFIRMADA}). El {@code IN :estadosEsperados} acepta los dos
     * orígenes válidos y mantiene el CAS: un doble "finalizar" concurrente deja
     * a uno con 1 fila y al otro con 0.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE SolicitudJpaEntity s "
            + "SET s.estado = :nuevoEstado, s.version = s.version + 1 "
            + "WHERE s.id = :id AND s.estado IN :estadosEsperados")
    int transicionAtomicaFinalizar(@Param("id") UUID id,
                                   @Param("estadosEsperados") Collection<EstadoSolicitud> estadosEsperados,
                                   @Param("nuevoEstado") EstadoSolicitud nuevoEstado);

    /**
     * Solicitudes PENDIENTES cuya ventana de accept ya venció, ordenadas por
     * vencimiento y acotadas para que el barrido no crezca sin límite.
     */
    List<SolicitudJpaEntity> findTop200ByEstadoAndTimeoutEnBeforeOrderByTimeoutEnAsc(
            EstadoSolicitud estado, Instant ahora);

    /**
     * Services ASSIGNED to a unit, newest first (creation instant descending).
     * The derived query filters by the assignment column, so a broadcast-only
     * request (null assignment) can never match.
     */
    List<SolicitudJpaEntity> findByAmbulanciaAsignadaIdOrderBySolicitadaEnDesc(UUID ambulanciaId);

    /**
     * CAS de expiración: UNA sola {@code UPDATE} que cierra la solicitud solo si
     * sigue PENDIENTE Y su {@code timeoutEn} ya pasó. La condición del
     * {@code WHERE} es la garantía: no compite con el accept (que exige
     * PENDIENTE) y dos barridos concurrentes no expiran dos veces la misma fila.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE SolicitudJpaEntity s "
            + "SET s.estado = :nuevoEstado, s.version = s.version + 1 "
            + "WHERE s.id = :id AND s.estado = :estadoEsperado AND s.timeoutEn < :ahora")
    int transicionAtomicaExpirar(@Param("id") UUID id,
                                 @Param("estadoEsperado") EstadoSolicitud estadoEsperado,
                                 @Param("nuevoEstado") EstadoSolicitud nuevoEstado,
                                 @Param("ahora") Instant ahora);

    /**
     * Requests in {@code estado} whose window is still open at {@code ahora} and
     * that were notified to {@code ambulanciaId} (EP-04.F2.US1, D6), oldest
     * first. {@code MEMBER OF} tests the unit against the notified collection in
     * the database, so the list is never filtered in memory.
     */
    @Query("SELECT s FROM SolicitudJpaEntity s "
            + "WHERE s.estado = :estado AND s.timeoutEn > :ahora "
            + "AND :ambulanciaId MEMBER OF s.ambulanciasNotificadas "
            + "ORDER BY s.solicitadaEn ASC")
    List<SolicitudJpaEntity> buscarPendientesNotificadasA(@Param("ambulanciaId") UUID ambulanciaId,
                                                         @Param("estado") EstadoSolicitud estado,
                                                         @Param("ahora") Instant ahora);

    /**
     * Requests in {@code estado} whose window is still open at {@code ahora} and
     * that were NOT notified to {@code ambulanciaId} (EP-04.F2.US1), oldest
     * first. The mirror of {@link #buscarPendientesNotificadasA}: the membership
     * test runs in the database.
     */
    @Query("SELECT s FROM SolicitudJpaEntity s "
            + "WHERE s.estado = :estado AND s.timeoutEn > :ahora "
            + "AND :ambulanciaId NOT MEMBER OF s.ambulanciasNotificadas "
            + "ORDER BY s.solicitadaEn ASC")
    List<SolicitudJpaEntity> buscarPendientesNoNotificadasA(@Param("ambulanciaId") UUID ambulanciaId,
                                                           @Param("estado") EstadoSolicitud estado,
                                                           @Param("ahora") Instant ahora);
}
