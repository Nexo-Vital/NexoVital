package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * Key of a decline: one row per request and unit, so a unit declines a request
 * at most once.
 */
@Embeddable
public class RechazoSolicitudId implements Serializable {

    private static final long serialVersionUID = 1L;

    @Column(name = "solicitud_id", nullable = false)
    private UUID solicitudId;

    @Column(name = "ambulancia_id", nullable = false)
    private UUID ambulanciaId;

    protected RechazoSolicitudId() {
    }

    public RechazoSolicitudId(UUID solicitudId, UUID ambulanciaId) {
        this.solicitudId = solicitudId;
        this.ambulanciaId = ambulanciaId;
    }

    public UUID getSolicitudId() {
        return solicitudId;
    }

    public UUID getAmbulanciaId() {
        return ambulanciaId;
    }

    @Override
    public boolean equals(Object otro) {
        if (this == otro) {
            return true;
        }
        if (!(otro instanceof RechazoSolicitudId that)) {
            return false;
        }
        return Objects.equals(solicitudId, that.solicitudId)
                && Objects.equals(ambulanciaId, that.ambulanciaId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(solicitudId, ambulanciaId);
    }
}
