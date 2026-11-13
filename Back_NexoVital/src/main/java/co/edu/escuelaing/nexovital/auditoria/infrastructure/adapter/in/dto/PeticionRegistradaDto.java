package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;

import java.time.Instant;
import java.util.UUID;

/**
 * Una fila de la bitácora de peticiones en la API. Solo de salida: la API no
 * acepta registros.
 */
public record PeticionRegistradaDto(
        UUID id,
        Instant ocurridoEn,
        String canal,
        String metodo,
        String ruta,
        int estado,
        Long duracionMs,
        UUID usuarioId,
        String usuarioRol,
        String actor,
        String ip,
        String pais,
        String navegador,
        String traceId,
        String instancia,
        String detalle) {

    public static PeticionRegistradaDto fromDomain(PeticionRegistrada p) {
        return new PeticionRegistradaDto(p.id(), p.ocurridoEn(), p.canal(), p.metodo(), p.ruta(),
                p.estado(), p.duracionMs(), p.usuarioId(), p.usuarioRol(), p.actor(), p.ip(), p.pais(),
                p.navegador(), p.traceId(), p.instancia(), p.detalle());
    }
}
