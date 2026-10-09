package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** A withdrawal of stock from a center: what, how much, why, who and when. */
public record RetiroInventario(UUID id, UUID centroAcopioId, UUID itemId, int cantidad, String motivo,
                               UUID usuarioId, Instant retiradoEn) {

    /** Longest reason accepted, the size of its column. */
    public static final int LONGITUD_MAXIMA_MOTIVO = 255;

    public RetiroInventario {
        Objects.requireNonNull(id, "id is required");
        Objects.requireNonNull(centroAcopioId, "centroAcopioId is required");
        Objects.requireNonNull(itemId, "itemId is required");
        Objects.requireNonNull(retiradoEn, "retiradoEn is required");
    }

    /** A new withdrawal; a blank reason is stored as none. */
    public static RetiroInventario nuevo(UUID centroAcopioId, UUID itemId, int cantidad, String motivo,
                                         UUID usuarioId, Instant retiradoEn) {
        String limpio = motivo == null || motivo.isBlank() ? null : motivo.strip();
        return new RetiroInventario(UUID.randomUUID(), centroAcopioId, itemId, cantidad, limpio, usuarioId,
                retiradoEn);
    }
}
