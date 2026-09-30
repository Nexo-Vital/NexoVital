package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.UUID;

/**
 * Public projection of a center in the map: {@code {id, nombre, tipo, zonaId,
 * ubicacion}}, plus the optional shortage alert (EP-03.F1.US5).
 *
 * <p>{@code alerta} is the WORST active alert of the center (largest missing
 * quantity) and {@code alertasActivas} how many active alerts it has: the
 * marker is per center while the data is per item, so the payload carries the
 * worst one and the count for the badge (FA-5). Both are OPTIONAL in the
 * contract so existing clients stay valid (FA-7). {@code alerta} is omitted
 * from the JSON when the center has none, so a strict client never sees a null
 * object.
 *
 * <p>{@code mapa} publishes its own DTO instead of exposing the inventory
 * module's one: each module's API is independent.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CentroDto(UUID id,
                        String nombre,
                        TipoOrganizacion tipo,
                        String zonaId,
                        UbicacionDto ubicacion,
                        AlertaEscasezDto alerta,
                        int alertasActivas) {

    public static CentroDto fromDomain(Organizacion organizacion, AlertaEscasezDto alerta, int alertasActivas) {
        return new CentroDto(
                organizacion.getId(),
                organizacion.getNombre(),
                organizacion.getTipo(),
                organizacion.getZonaId(),
                UbicacionDto.fromDomain(organizacion.getUbicacion()),
                alerta,
                alertasActivas);
    }
}
