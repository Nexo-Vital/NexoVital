package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.mapa.domain.model.Mapa;

import java.util.List;

/**
 * Proyección pública del mapa (contrato OpenAPI, schema {@code Mapa}):
 * {@code {zonas, centros}}.
 */
public record MapaDto(List<ZonaDto> zonas, List<CentroDto> centros) {

    public static MapaDto fromDomain(Mapa mapa) {
        return new MapaDto(
                mapa.zonas().stream().map(ZonaDto::fromDomain).toList(),
                mapa.centros().stream().map(CentroDto::fromDomain).toList());
    }
}
