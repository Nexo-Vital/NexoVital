package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;

import java.time.Instant;
import java.util.UUID;

/**
 * Proyección pública de una emergencia (contrato OpenAPI, schema
 * {@code Emergencia}): {@code {id, ubicacion, nivel, estado, descripcion,
 * createdAt}}.
 *
 * <p>{@code zonaId} es una propiedad ADICIONAL y opcional: el servidor la
 * resuelve por punto-en-polígono y puede ser {@code null} cuando el punto cae
 * fuera del catálogo (decisiones D4/D8 del diseño). Es aditiva, no rompe el
 * contrato.
 */
public record EmergenciaDto(UUID id,
                            UbicacionDto ubicacion,
                            NivelEmergencia nivel,
                            EstadoEmergencia estado,
                            String descripcion,
                            String zonaId,
                            Instant createdAt) {

    public static EmergenciaDto fromDomain(Emergencia emergencia) {
        return new EmergenciaDto(
                emergencia.getId(),
                UbicacionDto.fromDomain(emergencia.getUbicacion()),
                emergencia.getNivel(),
                emergencia.getEstado(),
                emergencia.getDescripcion(),
                emergencia.getZonaId(),
                emergencia.getCreatedAt());
    }
}
