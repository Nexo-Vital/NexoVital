package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/**
 * Vértice de un contorno de zona, como detalle de persistencia. El agregado de
 * dominio es
 * {@link co.edu.escuelaing.nexovital.mapa.domain.model.Zona} y no conoce esta
 * clase.
 *
 * <p>Sin PostGIS: el vértice son dos columnas {@code double} ({@code lat},
 * {@code lng}). El orden del contorno lo lleva la {@code @OrderColumn} de la
 * colección en {@link ZonaJpaEntity}, no este embeddable.
 */
@Embeddable
public class VerticeZonaJpa {

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lng;

    protected VerticeZonaJpa() {
        // Requerido por JPA.
    }

    public VerticeZonaJpa(double lat, double lng) {
        this.lat = lat;
        this.lng = lng;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }
}
