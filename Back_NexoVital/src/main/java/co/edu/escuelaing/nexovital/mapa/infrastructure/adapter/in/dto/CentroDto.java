package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.UUID;

/**
 * Public projection of a center in the map: {@code {id, nombre, tipo, zonaId,
 * ubicacion}}, plus its shortage alerts (EP-03.F1.US5 / EP-03.F3.US4).
 *
 * <p>{@code alertas} lists EVERY resource the center is missing, most missing
 * first, so a donor can see each center with the resource and the quantity it
 * lacks. It is always present (empty when the center needs nothing).
 * {@code alerta} repeats the worst one for the marker badge and
 * {@code alertasActivas} is the count; {@code alerta} is omitted from the JSON
 * when the center has none, so a strict client never sees a null object.
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
                        int alertasActivas,
                        List<AlertaEscasezDto> alertas) {

    public static CentroDto fromDomain(Organizacion organizacion, List<AlertaEscasezDto> alertas) {
        return new CentroDto(
                organizacion.getId(),
                organizacion.getNombre(),
                organizacion.getTipo(),
                organizacion.getZonaId(),
                UbicacionDto.fromDomain(organizacion.getUbicacion()),
                alertas.isEmpty() ? null : alertas.get(0),
                alertas.size(),
                List.copyOf(alertas));
    }
}
