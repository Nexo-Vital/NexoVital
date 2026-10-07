package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.ColumnDefault;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA row of a fleet unit. The domain never sees this class. {@code conductorId}
 * is the driver user id used as the per-user push key (D-F1).
 *
 * <p>The three signal columns (EP-04.F1.US1, D4) are written ONLY by the atomic
 * UPDATEs of {@link AmbulanciaJpaRepository}; there are no setters for them. A
 * new unit starts with no report instant, no source and {@code sinSenal = false}.
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

    /** Instant of the last accepted position report; null if it never reported. */
    @Column
    private Instant ultimaPosicionEn;

    /** Source of the last accepted report; null if it never reported. */
    @Enumerated(EnumType.STRING)
    @Column
    private FuentePosicion fuentePosicion;

    /**
     * True while the unit has gone longer than the threshold without reporting.
     * The column default lets a schema that already has rows (profile
     * {@code docker}, {@code ddl-auto=update}) gain the NOT NULL column.
     */
    @Column(nullable = false)
    @ColumnDefault("false")
    private boolean sinSenal;

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

    public Instant getUltimaPosicionEn() {
        return ultimaPosicionEn;
    }

    public FuentePosicion getFuentePosicion() {
        return fuentePosicion;
    }

    public boolean isSinSenal() {
        return sinSenal;
    }

    public long getVersion() {
        return version;
    }
}
