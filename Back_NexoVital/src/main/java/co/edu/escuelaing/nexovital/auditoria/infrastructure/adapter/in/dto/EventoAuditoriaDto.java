package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;

import java.time.Instant;
import java.util.UUID;

/**
 * Representación de un evento de la bitácora en la API.
 *
 * <p>Nunca se instancia desde un cuerpo de petición: la API no acepta eventos,
 * solo los devuelve. Por eso no hay {@code fromRequest}.
 */
public record EventoAuditoriaDto(
        UUID id,
        UUID actorId,
        String actorRol,
        String accion,
        String recursoTipo,
        UUID recursoId,
        String detalle,
        Instant ocurridoEn,
        String traceId) {

    public static EventoAuditoriaDto fromDomain(EventoAuditoria evento) {
        return new EventoAuditoriaDto(
                evento.id(),
                evento.actorId(),
                evento.actorRol(),
                evento.accion().name(),
                evento.recursoTipo(),
                evento.recursoId(),
                evento.detalle(),
                evento.ocurridoEn(),
                evento.traceId());
    }
}
