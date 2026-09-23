package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

/**
 * Entidad JPA de la tabla {@code organizaciones}. Es un detalle de
 * persistencia: el agregado de dominio es
 * {@link co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion} y no
 * la conoce.
 *
 * <p>Sin PostGIS: la ubicación se guarda como dos columnas {@code double}
 * ({@code lat}, {@code lng}).
 */
@Entity
@Table(name = "organizaciones")
public class OrganizacionJpaEntity {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 120)
    private String nombre;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private TipoOrganizacion tipo;

    @Column(name = "zona_id", nullable = false, length = 80)
    private String zonaId;

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lng;

    protected OrganizacionJpaEntity() {
        // Requerido por JPA.
    }

    public OrganizacionJpaEntity(UUID id, String nombre, TipoOrganizacion tipo, String zonaId, double lat, double lng) {
        this.id = id;
        this.nombre = nombre;
        this.tipo = tipo;
        this.zonaId = zonaId;
        this.lat = lat;
        this.lng = lng;
    }

    public UUID getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public TipoOrganizacion getTipo() {
        return tipo;
    }

    public String getZonaId() {
        return zonaId;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }
}
