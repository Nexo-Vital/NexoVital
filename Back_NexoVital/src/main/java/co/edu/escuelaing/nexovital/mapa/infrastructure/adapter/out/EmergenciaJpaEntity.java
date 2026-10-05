package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * Entidad JPA de la tabla {@code emergencias}. Es un detalle de persistencia: el
 * agregado de dominio es
 * {@link co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia} y no la conoce.
 *
 * <p>Sin PostGIS: la ubicación se guarda como dos columnas {@code double}
 * ({@code ubicacion_lat}, {@code ubicacion_lng}). {@code zona_id} es contexto
 * derivado y NULLABLE: el punto puede caer fuera de todo el catálogo.
 */
@Entity
@Table(name = "emergencias")
public class EmergenciaJpaEntity {

    @Id
    private UUID id;

    @Column(name = "ubicacion_lat", nullable = false)
    private double ubicacionLat;

    @Column(name = "ubicacion_lng", nullable = false)
    private double ubicacionLng;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TipoEmergencia tipo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private NivelEmergencia nivel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EstadoEmergencia estado;

    @Column(nullable = false, length = 500)
    private String descripcion;

    @Column(name = "zona_id", length = 120)
    private String zonaId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected EmergenciaJpaEntity() {
        // Requerido por JPA.
    }

    public EmergenciaJpaEntity(UUID id,
                               double ubicacionLat,
                               double ubicacionLng,
                               TipoEmergencia tipo,
                               NivelEmergencia nivel,
                               EstadoEmergencia estado,
                               String descripcion,
                               String zonaId,
                               Instant createdAt) {
        this.id = id;
        this.ubicacionLat = ubicacionLat;
        this.ubicacionLng = ubicacionLng;
        this.tipo = tipo;
        this.nivel = nivel;
        this.estado = estado;
        this.descripcion = descripcion;
        this.zonaId = zonaId;
        this.createdAt = createdAt;
    }

    public UUID getId() {
        return id;
    }

    public double getUbicacionLat() {
        return ubicacionLat;
    }

    public double getUbicacionLng() {
        return ubicacionLng;
    }

    public TipoEmergencia getTipo() {
        return tipo;
    }

    public NivelEmergencia getNivel() {
        return nivel;
    }

    public EstadoEmergencia getEstado() {
        return estado;
    }

    public String getDescripcion() {
        return descripcion;
    }

    public String getZonaId() {
        return zonaId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
