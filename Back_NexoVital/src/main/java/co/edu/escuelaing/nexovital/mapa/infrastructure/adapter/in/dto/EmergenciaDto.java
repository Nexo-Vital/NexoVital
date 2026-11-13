package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;

import java.time.Instant;
import java.util.UUID;

/**
 * Proyeccion publica de una emergencia (contrato OpenAPI, schema
 * {@code Emergencia}): {@code {id, ubicacion, tipo, nivel, estado,
 * descripcion, createdAt}}. {@code tipo} es el tipo de emergencia de
 * EP-02.F1.US3, anadido al contrato original.
 *
 * <p>{@code zonaId} es una propiedad ADICIONAL y opcional: el servidor la
 * resuelve por punto-en-poligono y puede ser {@code null} cuando el punto cae
 * fuera del catalogo (decisiones D4/D8 del diseno). Es aditiva, no rompe el
 * contrato.
 *
 * <p>{@code solicitudId} tambien es ADICIONAL y opcional: identifica la
 * solicitud de ambulancia que el backend creo al registrar la emergencia. El
 * cliente la usa para seguir el ciclo en curso sin pedir la ambulancia otra vez.
 * Puede ser {@code null} si no habia unidades disponibles.
 */
public record EmergenciaDto(UUID id,
                            UbicacionDto ubicacion,
                            TipoEmergencia tipo,
                            NivelEmergencia nivel,
                            EstadoEmergencia estado,
                            String descripcion,
                            String zonaId,
                            Instant createdAt,
                            UUID solicitudId) {

    public static EmergenciaDto fromDomain(Emergencia emergencia) {
        return fromDomain(emergencia, null);
    }

    public static EmergenciaDto fromDomain(Emergencia emergencia, UUID solicitudId) {
        return new EmergenciaDto(
                emergencia.getId(),
                UbicacionDto.fromDomain(emergencia.getUbicacion()),
                emergencia.getTipo(),
                emergencia.getNivel(),
                emergencia.getEstado(),
                emergencia.getDescripcion(),
                emergencia.getZonaId(),
                emergencia.getCreatedAt(),
                solicitudId);
    }
}
