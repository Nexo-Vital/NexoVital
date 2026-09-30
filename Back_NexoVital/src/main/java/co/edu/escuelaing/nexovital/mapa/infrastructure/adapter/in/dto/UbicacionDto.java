package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

/**
 * Proyección pública de una ubicación: {@code {lat, lng}} (contrato OpenAPI,
 * schema {@code Ubicacion}).
 */
public record UbicacionDto(double lat, double lng) {

    public static UbicacionDto fromDomain(Ubicacion ubicacion) {
        return new UbicacionDto(ubicacion.lat(), ubicacion.lng());
    }
}
