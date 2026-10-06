package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.util.Objects;

/**
 * Result of a donation: the item after the credit, how many units were
 * accepted and how many the donor offered. A donation is capped to what the
 * center still needs, so {@code aceptada <= solicitada}.
 */
public record DonacionAceptada(ItemInventario item, int aceptada, int solicitada) {

    public DonacionAceptada {
        Objects.requireNonNull(item, "item is required");
    }
}
