package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import org.hibernate.annotations.Immutable;

import java.time.Instant;
import java.util.UUID;

/**
 * Tabla de la bitácora de peticiones (T13).
 *
 * <p>La aplicación escribe en ella por lotes con JDBC
 * ({@link BitacoraPeticionesAdapter}); esta entidad existe para que Hibernate
 * cree y valide el esquema igual que el resto de tablas. Es {@link Immutable} y
 * no tiene setters: una fila se escribe una vez y no se reescribe.
 *
 * <p>Índices: por fecha (la consulta sin filtro trae lo más reciente), por
 * usuario y fecha, y por {@code traceId} (una petición concreta, y el cruce con
 * las acciones críticas de {@code auditoria_eventos}).
 */
@Entity
@Immutable
@Table(name = "auditoria_peticiones",
        indexes = {
                @Index(name = "idx_peticiones_fecha", columnList = "ocurrido_en"),
                @Index(name = "idx_peticiones_usuario", columnList = "usuario_id,ocurrido_en"),
                @Index(name = "idx_peticiones_traza", columnList = "trace_id")
        })
public class PeticionRegistradaJpaEntity {

    @Id
    private UUID id;

    @Column(name = "ocurrido_en", nullable = false)
    private Instant ocurridoEn;

    @Column(nullable = false, length = 10)
    private String canal;

    @Column(nullable = false, length = 20)
    private String metodo;

    @Column(length = 500)
    private String ruta;

    @Column(nullable = false)
    private int estado;

    @Column(name = "duracion_ms")
    private Long duracionMs;

    @Column(name = "usuario_id")
    private UUID usuarioId;

    @Column(name = "usuario_rol", length = 40)
    private String usuarioRol;

    @Column(length = 160)
    private String actor;

    @Column(length = 64)
    private String ip;

    @Column(length = 20)
    private String pais;

    @Column(length = 300)
    private String navegador;

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @Column(length = 100)
    private String instancia;

    @Column(length = 200)
    private String detalle;

    protected PeticionRegistradaJpaEntity() {
        // Requerido por JPA.
    }

    public UUID getId() {
        return id;
    }

    public Instant getOcurridoEn() {
        return ocurridoEn;
    }

    public String getRuta() {
        return ruta;
    }

    public String getPais() {
        return pais;
    }
}
