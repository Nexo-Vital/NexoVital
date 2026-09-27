package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Read projection of an {@link AlertaEscasez} joined with the stock the item
 * holds right now: the shape another module consumes through the public port
 * of {@code recursos} (the {@code mapa} reads it to paint the worst alert of a
 * center, FA-5).
 *
 * <p>It is not a domain aggregate: it carries the computed {@code faltante}
 * because only {@code recursos} knows both the demand and the current stock,
 * and the map must not read inventory on its own.
 */
public record AlertaEscasezActiva(UUID centroAcopioId,
                                  UUID itemId,
                                  String nombre,
                                  int cantidadSolicitada,
                                  int disponibleActual,
                                  int faltante,
                                  Instant creadaEn) {

    public AlertaEscasezActiva {
        Objects.requireNonNull(centroAcopioId, "centroAcopioId is required");
        Objects.requireNonNull(itemId, "itemId is required");
        Objects.requireNonNull(nombre, "nombre is required");
        Objects.requireNonNull(creadaEn, "creadaEn is required");
    }
}
