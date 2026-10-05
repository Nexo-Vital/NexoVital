package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity of the {@code alertas_escasez} table. It is a persistence detail:
 * the domain model is
 * {@link co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez} and
 * does not know it.
 *
 * <p>{@code centro_acopio_id} and {@code item_id} are plain references (no
 * cross-module foreign key, ADR-0003). It stores the DEMAND
 * ({@code cantidad_solicitada}), never a frozen deficit: the missing quantity
 * is computed at read time against the current stock (FA-2).
 *
 * <p><b>One row per item of a center.</b> The unique constraint on
 * {@code (centro_acopio_id, item_id)} is what makes "search, and create when
 * missing" safe under concurrency: of N rejections that all find no alert and
 * all try to insert, the database lets exactly one through and the rest fail
 * and retry (see {@code RegistrarAlertaEscasezUseCaseImpl}). Without it each
 * one would leave its own row and the center would count N alerts.
 */
@Entity
@Table(name = "alertas_escasez",
        uniqueConstraints = @UniqueConstraint(
                name = AlertaEscasezJpaEntity.UNICA_POR_CENTRO_E_ITEM,
                columnNames = {"centro_acopio_id", "item_id"}))
public class AlertaEscasezJpaEntity {

    /** Name of the unique constraint that keeps one alert per item of a center. */
    public static final String UNICA_POR_CENTRO_E_ITEM = "uk_alerta_escasez_centro_item";

    @Id
    private UUID id;

    @Column(name = "centro_acopio_id", nullable = false)
    private UUID centroAcopioId;

    @Column(name = "item_id", nullable = false)
    private UUID itemId;

    @Column(nullable = false, length = 120)
    private String nombre;

    @Column(name = "cantidad_solicitada", nullable = false)
    private int cantidadSolicitada;

    @Column(name = "creada_en", nullable = false)
    private Instant creadaEn;

    protected AlertaEscasezJpaEntity() {
        // Required by JPA.
    }

    public AlertaEscasezJpaEntity(UUID id,
                                  UUID centroAcopioId,
                                  UUID itemId,
                                  String nombre,
                                  int cantidadSolicitada,
                                  Instant creadaEn) {
        this.id = id;
        this.centroAcopioId = centroAcopioId;
        this.itemId = itemId;
        this.nombre = nombre;
        this.cantidadSolicitada = cantidadSolicitada;
        this.creadaEn = creadaEn;
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

    public String getNombre() {
        return nombre;
    }

    public int getCantidadSolicitada() {
        return cantidadSolicitada;
    }

    public Instant getCreadaEn() {
        return creadaEn;
    }
}
