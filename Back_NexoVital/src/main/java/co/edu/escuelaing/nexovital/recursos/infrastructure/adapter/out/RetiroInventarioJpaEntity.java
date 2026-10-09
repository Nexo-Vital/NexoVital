package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** JPA entity of the {@code retiros_inventario} table (one row per withdrawal). */
@Entity
@Table(name = "retiros_inventario")
public class RetiroInventarioJpaEntity {

    @Id
    private UUID id;

    @Column(name = "centro_acopio_id", nullable = false)
    private UUID centroAcopioId;

    @Column(name = "item_id", nullable = false)
    private UUID itemId;

    @Column(nullable = false)
    private int cantidad;

    @Column(length = 255)
    private String motivo;

    @Column(name = "usuario_id")
    private UUID usuarioId;

    @Column(name = "retirado_en", nullable = false)
    private Instant retiradoEn;

    protected RetiroInventarioJpaEntity() {
    }

    public RetiroInventarioJpaEntity(UUID id, UUID centroAcopioId, UUID itemId, int cantidad, String motivo,
                                     UUID usuarioId, Instant retiradoEn) {
        this.id = id;
        this.centroAcopioId = centroAcopioId;
        this.itemId = itemId;
        this.cantidad = cantidad;
        this.motivo = motivo;
        this.usuarioId = usuarioId;
        this.retiradoEn = retiradoEn;
    }

    public UUID getId() {
        return id;
    }

    public UUID getCentroAcopioId() {
        return centroAcopioId;
    }

    public UUID getItemId() {
        return itemId;
    }

    public int getCantidad() {
        return cantidad;
    }

    public String getMotivo() {
        return motivo;
    }

    public UUID getUsuarioId() {
        return usuarioId;
    }

    public Instant getRetiradoEn() {
        return retiradoEn;
    }
}
