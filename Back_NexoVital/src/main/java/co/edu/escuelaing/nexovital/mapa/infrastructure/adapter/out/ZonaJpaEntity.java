package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;

import java.util.ArrayList;
import java.util.List;

/**
 * Entidad JPA de la tabla {@code zonas}. Es un detalle de persistencia: el
 * agregado de dominio es
 * {@link co.edu.escuelaing.nexovital.mapa.domain.model.Zona} y no la conoce.
 *
 * <p>Sin PostGIS: la ubicación de referencia se guarda como dos columnas
 * {@code double} ({@code lat}, {@code lng}), y el contorno (la zona como área)
 * en la tabla hija {@code zona_vertices}, ordenada por {@code posicion}.
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

    /**
     * Vértices del contorno. {@code EAGER} a propósito: el adaptador mapea a
     * dominio fuera de una transacción abierta, así que el contorno debe venir
     * cargado en la misma consulta.
     */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "zona_vertices", joinColumns = @JoinColumn(name = "zona_id"))
    @OrderColumn(name = "posicion")
    private List<VerticeZonaJpa> contorno = new ArrayList<>();

    protected ZonaJpaEntity() {
        // Requerido por JPA.
    }

    public ZonaJpaEntity(String id, String nombre, double lat, double lng, List<VerticeZonaJpa> contorno) {
        this.id = id;
        this.nombre = nombre;
        this.lat = lat;
        this.lng = lng;
        this.contorno = new ArrayList<>(contorno);
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

    public List<VerticeZonaJpa> getContorno() {
        return contorno;
    }
}
