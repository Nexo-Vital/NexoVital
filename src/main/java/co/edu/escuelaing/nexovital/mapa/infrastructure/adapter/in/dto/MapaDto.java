package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.mapa.domain.model.Mapa;
import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;

import java.util.Comparator;
import java.util.List;

/**
 * Proyección pública del mapa (contrato OpenAPI, schema {@code Mapa}):
 * {@code {zonas, centros}}. Cada centro lleva la PEOR alerta activa (mayor
 * faltante) y cuántas tiene (FA-5); los centros sin alerta no publican el campo
 * (FA-7).
 */
public record MapaDto(List<ZonaDto> zonas, List<CentroDto> centros) {

    public static MapaDto fromDomain(Mapa mapa) {
        return new MapaDto(
                mapa.zonas().stream().map(ZonaDto::fromDomain).toList(),
                mapa.centros().stream()
                        .map(centro -> aCentroDto(centro, mapa.alertas()))
                        .toList());
    }

    private static CentroDto aCentroDto(Organizacion centro, List<AlertaEscasezActiva> alertas) {
        List<AlertaEscasezActiva> delCentro = alertas.stream()
                .filter(alerta -> alerta.centroAcopioId().equals(centro.getId()))
                .toList();
        AlertaEscasezDto peor = delCentro.stream()
                .max(Comparator.comparingInt(AlertaEscasezActiva::faltante))
                .map(AlertaEscasezDto::fromDomain)
                .orElse(null);
        return CentroDto.fromDomain(centro, peor, delCentro.size());
    }
}
