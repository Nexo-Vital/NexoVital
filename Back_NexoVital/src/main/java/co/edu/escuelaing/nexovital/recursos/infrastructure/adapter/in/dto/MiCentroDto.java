package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.recursos.domain.model.MiCentro;

import java.util.List;
import java.util.UUID;

/**
 * Proyección del centro de un administrador:
 * {@code {id, nombre, ubicacion: {lat, lng}, items: [InventarioItem]}}. Los
 * {@code items} tienen la misma forma que sirve
 * {@code GET /api/v1/centros-acopio/{id}/inventario}.
 */
public record MiCentroDto(UUID id, String nombre, UbicacionDto ubicacion, List<ItemInventarioDto> items) {

    /** Coordenada del centro: {@code {lat, lng}}. */
    public record UbicacionDto(double lat, double lng) {
    }

    public static MiCentroDto fromDomain(MiCentro miCentro) {
        return new MiCentroDto(
                miCentro.centro().id(),
                miCentro.centro().nombre(),
                new UbicacionDto(miCentro.centro().lat(), miCentro.centro().lng()),
                miCentro.items().stream().map(ItemInventarioDto::fromDomain).toList());
    }
}
