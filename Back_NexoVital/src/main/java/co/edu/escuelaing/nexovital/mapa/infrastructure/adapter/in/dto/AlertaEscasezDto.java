package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;

import java.util.UUID;

/**
 * Public projection of an active shortage alert of a center (contrato OpenAPI,
 * schema {@code AlertaEscasez}): the resource, how much the center declared it
 * needs, how much it holds and how much is missing.
 *
 * <p>{@code faltante} is {@code requerido - disponible} read from the current
 * inventory, never a stored deficit: it shrinks as donations arrive and the
 * alert disappears when the need is covered.
 */
public record AlertaEscasezDto(UUID itemId,
                               String nombre,
                               int requerido,
                               int disponible,
                               int faltante) {

    public static AlertaEscasezDto fromDomain(AlertaEscasezActiva alerta) {
        return new AlertaEscasezDto(
                alerta.itemId(),
                alerta.nombre(),
                alerta.requerido(),
                alerta.disponible(),
                alerta.faltante());
    }
}
