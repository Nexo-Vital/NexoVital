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
 *
 * <p>{@code conectada} (EP-04.F2.US1, D2) follows the same rule: it is written
 * ONLY by the atomic UPDATEs of the repository and has no setter. A new unit
 * starts connected.
 */
@Entity
@Table(name = "ambulancias", schema = "flota")
public class AmbulanciaJpaEntity {

    @Id
    private UUID id;

    /**
     * Sin restricción UNIQUE: Citus exige que todo índice único incluya la
     * columna de distribución, y esta tabla se distribuye por {@code id}
     * (deploy/citus/distribuir.sql). La placa no se crea por API —solo la siembra
     * el seeder—, así que la unicidad no es una invariante que el producto
     * necesite a nivel de base para escalar horizontalmente.
     */
    @Column(nullable = false)
    private String placa;

    /**
     * Modelo del vehículo que declara el conductor al registrarse (T10). Es
     * nulo en las unidades sembradas, que se crearon antes de pedir el dato.
     */
    @Column(length = 60)
    private String modelo;

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

    /**
     * True while the driver is connected to the service. A unit is born
     * connected, so the field initializer and the column default are both
     * {@code true}: the initializer covers a row inserted by JPA and the default
     * covers a schema that already has rows.
     */
    @Column(nullable = false)
    @ColumnDefault("true")
    private boolean conectada = true;

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

    /**
     * Unidad de un conductor que se registra con Google (T10). Nace
     * DESCONECTADA: recibe solicitudes solo cuando el conductor abre su consola
     * y se conecta, no antes, aunque nunca haya entrado a la aplicación.
     */
    public static AmbulanciaJpaEntity deConductorRegistrado(UUID id, String placa, String modelo,
                                                            double lat, double lng, String zona,
                                                            UUID conductorId) {
        AmbulanciaJpaEntity unidad = new AmbulanciaJpaEntity(
                id, placa, EstadoAmbulancia.DISPONIBLE, lat, lng, zona, conductorId);
        unidad.modelo = modelo;
        unidad.conectada = false;
        return unidad;
    }

    public UUID getId() {
        return id;
    }

    public String getModelo() {
        return modelo;
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

    public boolean isConectada() {
        return conectada;
    }

    public long getVersion() {
        return version;
    }
}
