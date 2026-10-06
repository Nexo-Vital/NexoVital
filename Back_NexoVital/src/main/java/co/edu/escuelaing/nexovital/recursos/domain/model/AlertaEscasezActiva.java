package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Active shortage alert of one resource of a center: the center declared it
 * needs {@code requerido} units, holds {@code disponible} and is therefore
 * missing {@code faltante} (EP-03.F1.US5 / EP-03.F3.US4).
 *
 * <p>It is a READ projection, never stored: an alert exists exactly while
 * {@code disponible < requerido}, so it is derived from the inventory on every
 * read. A donation that completes the need makes it disappear on its own and
 * there is no second table that could drift from the stock.
 *
 * <p>Other modules consume it through the public port of {@code recursos}
 * (the {@code mapa} paints it per center).
 */
public record AlertaEscasezActiva(UUID centroAcopioId,
                                  UUID itemId,
                                  String nombre,
                                  int requerido,
                                  int disponible,
                                  int faltante) {

    public AlertaEscasezActiva {
        Objects.requireNonNull(centroAcopioId, "centroAcopioId is required");
        Objects.requireNonNull(itemId, "itemId is required");
        Objects.requireNonNull(nombre, "nombre is required");
        if (faltante < 1) {
            throw new IllegalArgumentException("Una alerta activa siempre tiene faltante positivo.");
        }
    }

    /**
     * Alert of an item, or empty when the item needs nothing: no requirement
     * declared, or the stock already covers it.
     */
    public static Optional<AlertaEscasezActiva> de(ItemInventario item) {
        int faltante = item.getRequerido() - item.getDisponible();
        if (faltante < 1) {
            return Optional.empty();
        }
        return Optional.of(new AlertaEscasezActiva(
                item.getCentroAcopioId(),
                item.getId(),
                item.getNombre(),
                item.getRequerido(),
                item.getDisponible(),
                faltante));
    }
}
