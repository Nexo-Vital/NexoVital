package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
}
