package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

/**
 * Entidad JPA de la tabla {@code inventario_items}. Es un detalle de
 * persistencia: el agregado de dominio es
 * {@link co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario} y no
 * la conoce.
 *
 * <p>{@code centro_acopio_id} es una referencia simple al id de la organización
 * dueña: no hay clave foránea entre módulos (ADR-0003), igual que {@code
 * zona_id} en {@code organizaciones}. {@code requerido} puede ser 0 (sin
 * requerimiento declarado) y {@code unidad} / {@code unit_detail} son detalles
 * opcionales que el contrato no publica.
 */
@Entity
@Table(name = "inventario_items")
public class ItemInventarioJpaEntity {

    @Id
    private UUID id;

    @Column(name = "centro_acopio_id", nullable = false)
    private UUID centroAcopioId;

    @Column(nullable = false, length = 120)
    private String nombre;

    @Column(nullable = false)
    private int disponible;

    @Column(nullable = false)
    private int requerido;

    @Column(length = 40)
    private String unidad;

    @Column(name = "unit_detail", length = 80)
    private String unitDetail;

    protected ItemInventarioJpaEntity() {
        // Requerido por JPA.
    }

    public ItemInventarioJpaEntity(UUID id,
                                   UUID centroAcopioId,
                                   String nombre,
                                   int disponible,
                                   int requerido,
                                   String unidad,
                                   String unitDetail) {
        this.id = id;
        this.centroAcopioId = centroAcopioId;
        this.nombre = nombre;
        this.disponible = disponible;
        this.requerido = requerido;
        this.unidad = unidad;
        this.unitDetail = unitDetail;
    }

    public UUID getId() {
        return id;
    }

    public UUID getCentroAcopioId() {
        return centroAcopioId;
    }

    public String getNombre() {
        return nombre;
    }

    public int getDisponible() {
        return disponible;
    }

    public int getRequerido() {
        return requerido;
    }

    public String getUnidad() {
        return unidad;
    }

    public String getUnitDetail() {
        return unitDetail;
    }
}
