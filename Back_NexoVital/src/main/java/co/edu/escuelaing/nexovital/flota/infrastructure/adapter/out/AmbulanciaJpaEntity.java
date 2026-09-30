package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.util.UUID;

/**
 * JPA row of a fleet unit. The domain never sees this class. {@code conductorId}
 * is the driver user id used as the per-user push key (D-F1).
 */
@Entity
@Table(name = "ambulancias")
public class AmbulanciaJpaEntity {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String placa;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EstadoAmbulancia estado;

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lng;

    @Column(nullable = false)
    private String zona;

    /** Driver user id; nullable because a unit can exist without a driver. */
    @Column
    private UUID conductorId;

    @Version
    private long version;

    protected AmbulanciaJpaEntity() {
    }

    public AmbulanciaJpaEntity(UUID id, String placa, EstadoAmbulancia estado,
                               double lat, double lng, String zona, UUID conductorId) {
        this.id = id;
        this.placa = placa;
        this.estado = estado;
        this.lat = lat;
        this.lng = lng;
        this.zona = zona;
        this.conductorId = conductorId;
    }

    public UUID getId() {
        return id;
    }

    public String getPlaca() {
        return placa;
    }

    public EstadoAmbulancia getEstado() {
        return estado;
    }

    public void setEstado(EstadoAmbulancia estado) {
        this.estado = estado;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }

    public String getZona() {
        return zona;
    }

    public UUID getConductorId() {
        return conductorId;
    }

    public long getVersion() {
        return version;
    }
}
