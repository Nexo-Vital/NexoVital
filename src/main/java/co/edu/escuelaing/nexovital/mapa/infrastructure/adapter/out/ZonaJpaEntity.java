package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Entidad JPA de la tabla {@code zonas}. Es un detalle de persistencia: el
 * agregado de dominio es
 * {@link co.edu.escuelaing.nexovital.mapa.domain.model.Zona} y no la conoce.
 *
 * <p>Sin PostGIS: la ubicación se guarda como dos columnas {@code double}
 * ({@code lat}, {@code lng}).
 */
@Entity
@Table(name = "zonas")
public class ZonaJpaEntity {

    @Id
    @Column(length = 80)
    private String id;

    @Column(nullable = false, length = 120)
    private String nombre;

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lng;

    protected ZonaJpaEntity() {
        // Requerido por JPA.
    }

    public ZonaJpaEntity(String id, String nombre, double lat, double lng) {
        this.id = id;
        this.nombre = nombre;
        this.lat = lat;
        this.lng = lng;
    }

    public String getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }
}
