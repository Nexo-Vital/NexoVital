package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface RechazoSolicitudJpaRepository
        extends JpaRepository<RechazoSolicitudJpaEntity, RechazoSolicitudId> {

    /** Declines of the given requests, oldest first. One query for a whole list. */
    @Query("SELECT r FROM RechazoSolicitudJpaEntity r "
            + "WHERE r.id.solicitudId IN :solicitudIds "
            + "ORDER BY r.rechazadaEn ASC")
    List<RechazoSolicitudJpaEntity> buscarPorSolicitudes(@Param("solicitudIds") Collection<UUID> solicitudIds);
}
