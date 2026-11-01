package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * Entidad JPA de la bitácora. Es un detalle de persistencia: el agregado de
 * dominio es {@code EventoAuditoria} y no la conoce.
 *
 * <p>El índice compuesto {@code (recurso_tipo, recurso_id, ocurrido_en)} existe
 * porque las dos consultas del escenario filtran exactamente por esas columnas y
 * ordenan por fecha; sin él, la traza de una emergencia recorre la tabla entera.
 *
 * <p>No hay setters: una fila de auditoría se escribe una vez y no se modifica.
 */
@Entity
@Table(name = "auditoria_eventos",
        indexes = @Index(name = "idx_auditoria_recurso",
                columnList = "recurso_tipo,recurso_id,ocurrido_en"))
public class EventoAuditoriaJpaEntity {

    @Id
    private UUID id;

    @Column(name = "actor_id")
    private UUID actorId;

    @Column(name = "actor_rol", length = 40)
    private String actorRol;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private AccionCritica accion;

    @Column(name = "recurso_tipo", nullable = false, length = 30)
    private String recursoTipo;

    @Column(name = "recurso_id", nullable = false)
    private UUID recursoId;

    @Column(length = 500)
    private String detalle;

    @Column(name = "ocurrido_en", nullable = false)
    private Instant ocurridoEn;

    protected EventoAuditoriaJpaEntity() {
        // Requerido por JPA.
    }

    public EventoAuditoriaJpaEntity(UUID id, UUID actorId, String actorRol, AccionCritica accion,
                                    String recursoTipo, UUID recursoId, String detalle,
                                    Instant ocurridoEn) {
        this.id = id;
        this.actorId = actorId;
        this.actorRol = actorRol;
        this.accion = accion;
        this.recursoTipo = recursoTipo;
        this.recursoId = recursoId;
        this.detalle = detalle;
        this.ocurridoEn = ocurridoEn;
    }

    public UUID getId() {
        return id;
    }

    public UUID getActorId() {
        return actorId;
    }

    public String getActorRol() {
        return actorRol;
    }

    public AccionCritica getAccion() {
        return accion;
    }

    public String getRecursoTipo() {
        return recursoTipo;
    }

    public UUID getRecursoId() {
        return recursoId;
    }

    public String getDetalle() {
        return detalle;
    }

    public Instant getOcurridoEn() {
        return ocurridoEn;
    }
}
