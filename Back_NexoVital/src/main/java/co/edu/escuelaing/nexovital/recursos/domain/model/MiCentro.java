package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.util.List;
import java.util.Objects;

/**
 * El centro de un administrador junto con su inventario: lo que la pantalla
 * "Administrar mi centro" necesita en una sola lectura.
 */
public record MiCentro(CentroPropio centro, List<ItemInventario> items) {

    public MiCentro {
        Objects.requireNonNull(centro, "centro is required");
        items = List.copyOf(items);
    }
}
