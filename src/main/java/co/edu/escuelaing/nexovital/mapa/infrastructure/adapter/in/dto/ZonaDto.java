package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;

/**
 * Proyección pública de una zona (contrato OpenAPI, schema {@code Zona}):
 * {@code {id, nombre, ubicacion}}.
 */
public record ZonaDto(String id, String nombre, UbicacionDto ubicacion) {

    public static ZonaDto fromDomain(Zona zona) {
        return new ZonaDto(
                zona.getId(),
                zona.getNombre(),
                UbicacionDto.fromDomain(zona.getUbicacion()));
    }
}
