package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;

import java.util.UUID;

/**
 * Proyección pública de una organización (contrato OpenAPI, schema
 * {@code Organizacion}): {@code {id, nombre, tipo, zonaId, ubicacion}}.
 */
public record OrganizacionDto(UUID id, String nombre, TipoOrganizacion tipo, String zonaId, UbicacionDto ubicacion) {

    public static OrganizacionDto fromDomain(Organizacion organizacion) {
        return new OrganizacionDto(
                organizacion.getId(),
                organizacion.getNombre(),
                organizacion.getTipo(),
                organizacion.getZonaId(),
                UbicacionDto.fromDomain(organizacion.getUbicacion()));
    }
}
