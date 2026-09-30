package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;

import java.util.List;

/**
 * Proyección pública de una zona (contrato OpenAPI, schema {@code Zona}):
 * {@code {id, nombre, ubicacion, contorno}}. {@code ubicacion} es el punto de
 * referencia y {@code contorno} la lista de vértices que dibuja la zona como
 * ÁREA.
 */
public record ZonaDto(String id, String nombre, UbicacionDto ubicacion, List<UbicacionDto> contorno) {

    public static ZonaDto fromDomain(Zona zona) {
        return new ZonaDto(
                zona.getId(),
                zona.getNombre(),
                UbicacionDto.fromDomain(zona.getUbicacion()),
                zona.getContorno().stream().map(UbicacionDto::fromDomain).toList());
    }
}
