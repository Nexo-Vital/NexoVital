package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;

import java.util.UUID;

/**
 * Proyección pública de un centro en el mapa: {@code {id, nombre, tipo,
 * zonaId, ubicacion}}, la misma forma que el schema {@code Organizacion} del
 * contrato. {@code mapa} publica su propio DTO en vez de exponer el de
 * {@code usuarios}: la API de cada módulo no depende de la del vecino.
 *
 * <p>Sin inventario ni semáforo: son del módulo {@code recursos} (EP-03).
 */
public record CentroDto(UUID id, String nombre, TipoOrganizacion tipo, String zonaId, UbicacionDto ubicacion) {

    public static CentroDto fromDomain(Organizacion organizacion) {
        return new CentroDto(
                organizacion.getId(),
                organizacion.getNombre(),
                organizacion.getTipo(),
                organizacion.getZonaId(),
                UbicacionDto.fromDomain(organizacion.getUbicacion()));
    }
}
