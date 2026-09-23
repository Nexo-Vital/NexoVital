package co.edu.escuelaing.nexovital.mapa.domain.model;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;

import java.util.List;
import java.util.Objects;

/**
 * Read-model del mapa: las zonas propias del módulo y los centros leídos de
 * {@code usuarios}. No tiene comportamiento de negocio, solo transporta lo que
 * el endpoint publica.
 *
 * <p>No incluye inventario ni semáforo: son del módulo {@code recursos}
 * (EP-03), que aún no existe. No se finge.
 */
public record Mapa(List<Zona> zonas, List<Organizacion> centros) {

    public Mapa {
        zonas = List.copyOf(Objects.requireNonNull(zonas, "zonas es obligatorio"));
        centros = List.copyOf(Objects.requireNonNull(centros, "centros es obligatorio"));
    }
}
