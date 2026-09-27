package co.edu.escuelaing.nexovital.mapa.domain.model;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;

import java.util.List;
import java.util.Objects;

/**
 * Read-model of the map: the module's own zones, the centers read from
 * {@code usuarios} and the active shortage alerts read from {@code recursos}.
 * It has no business behavior, it only carries what the endpoint publishes.
 *
 * <p>The alerts are kept as a flat list: grouping them per center (worst alert
 * plus count) is a projection decision of the inbound DTO (FA-5).
 */
public record Mapa(List<Zona> zonas, List<Organizacion> centros, List<AlertaEscasezActiva> alertas) {

    public Mapa {
        zonas = List.copyOf(Objects.requireNonNull(zonas, "zonas es obligatorio"));
        centros = List.copyOf(Objects.requireNonNull(centros, "centros es obligatorio"));
        alertas = List.copyOf(Objects.requireNonNull(alertas, "alertas es obligatorio"));
    }
}
