package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * A unit declined a request (EP-04.F2.US5).
 *
 * <p>It lives in its own table, apart from the request row, on purpose: a
 * decline never changes the request, so it must not compete with the accept,
 * the expiry or the late offer for the request's row or its {@code @Version}.
 * Two units declining at the same instant write two different rows.
 */
@Entity
@Table(name = "solicitud_ambulancia_rechazos")
public class RechazoSolicitudJpaEntity {

    @EmbeddedId
    private RechazoSolicitudId id;

    @Column(name = "rechazada_en", nullable = false)
    private Instant rechazadaEn;

    protected RechazoSolicitudJpaEntity() {
    }

    public RechazoSolicitudJpaEntity(UUID solicitudId, UUID ambulanciaId, Instant rechazadaEn) {
        this.id = new RechazoSolicitudId(solicitudId, ambulanciaId);
        this.rechazadaEn = rechazadaEn;
    }

    public UUID getSolicitudId() {
        return id.getSolicitudId();
    }

    public UUID getAmbulanciaId() {
        return id.getAmbulanciaId();
    }

    public Instant getRechazadaEn() {
        return rechazadaEn;
    }
}
