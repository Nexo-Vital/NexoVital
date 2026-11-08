package co.edu.escuelaing.nexovital.auditoria.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Un hecho auditable: quién lo hizo, qué hizo, sobre qué recurso, con qué
 * detalle y cuándo.
 *
 * <p>{@code recursoTipo} + {@code recursoId} es lo que permite las dos consultas
 * que exige el escenario: la traza de una emergencia
 * ({@code recursoTipo = EMERGENCIA}) y la de un centro de acopio
 * ({@code recursoTipo = CENTRO_ACOPIO}).
 *
 * <p>El rol del actor lo completa el adaptador de persistencia a partir del
 * contexto de seguridad, porque el caso de uso conoce el id del llamante pero no
 * su rol. Se guarda con el evento y no se recalcula al leer: si mañana cambia el
 * rol de la persona, la bitácora debe seguir contando lo que era cierto ese día.
 */
public record EventoAuditoria(
        UUID id,
        UUID actorId,
        String actorRol,
        AccionCritica accion,
        String recursoTipo,
        UUID recursoId,
        String detalle,
        Instant ocurridoEn) {

    /** Recurso de tipo emergencia: se consulta con {@code porEmergencia}. */
    public static final String TIPO_EMERGENCIA = "EMERGENCIA";
    /** Recurso de tipo centro de acopio: se consulta con {@code porCentro}. */
    public static final String TIPO_CENTRO = "CENTRO_ACOPIO";
    /**
     * Recurso de tipo solicitud: una solicitud creada directamente (sin
     * emergencia) también tiene traza. Si la solicitud vino de una emergencia, el
     * evento se cuelga de la emergencia para que su traza sea completa.
     */
    public static final String TIPO_SOLICITUD = "SOLICITUD";

    public EventoAuditoria {
        Objects.requireNonNull(accion, "accion");
        Objects.requireNonNull(recursoTipo, "recursoTipo");
        Objects.requireNonNull(recursoId, "recursoId");
    }

    /**
     * Construye un evento nuevo. El rol queda nulo a propósito: lo resuelve el
     * adaptador, que sí tiene acceso al contexto de seguridad.
     */
    public static EventoAuditoria nuevo(AccionCritica accion,
                                        String recursoTipo,
                                        UUID recursoId,
                                        UUID actorId,
                                        String detalle,
                                        Instant ocurridoEn) {
        return new EventoAuditoria(
                UUID.randomUUID(), actorId, null, accion, recursoTipo, recursoId, detalle, ocurridoEn);
    }
}
