package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;

import java.time.Instant;
import java.util.UUID;

/**
 * Public projection of the worst active shortage alert of a center (contrato
 * OpenAPI, schema {@code AlertaEscasez}, optional field of {@code Organizacion}
 * per FA-7).
 *
 * <p>{@code faltante} is the CURRENT missing quantity
 * ({@code cantidadSolicitada - disponibleActual}), not a stored deficit: it
 * shrinks on its own as donations arrive (FA-2).
 */
public record AlertaEscasezDto(UUID itemId,
                               String nombre,
                               int cantidadSolicitada,
                               int faltante,
                               Instant creadaEn) {

    public static AlertaEscasezDto fromDomain(AlertaEscasezActiva alerta) {
        return new AlertaEscasezDto(
                alerta.itemId(),
                alerta.nombre(),
                alerta.cantidadSolicitada(),
                alerta.faltante(),
                alerta.creadaEn());
    }
}
