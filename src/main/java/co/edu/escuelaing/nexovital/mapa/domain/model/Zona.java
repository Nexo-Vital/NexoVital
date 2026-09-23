package co.edu.escuelaing.nexovital.mapa.domain.model;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

import java.util.Objects;

/**
 * Agregado de una zona del mapa: una localidad de Bogotá con su punto de
 * referencia. Inmutable y sin dependencias de framework, igual que
 * {@link co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion}.
 *
 * <p>El {@code id} es el mismo valor que las organizaciones usan en su
 * {@code zonaId}: una referencia simple entre módulos, sin clave foránea.
 *
 * <p>La ubicación es un punto (centroide) y no un polígono: el entorno local
 * usa H2 sin PostGIS, así que una zona se representa con un par de
 * coordenadas.
 */
public final class Zona {

    private final String id;
    private final String nombre;
    private final Ubicacion ubicacion;

    public Zona(String id, String nombre, Ubicacion ubicacion) {
        this.id = Objects.requireNonNull(id, "id es obligatorio");
        this.nombre = Objects.requireNonNull(nombre, "nombre es obligatorio");
        this.ubicacion = Objects.requireNonNull(ubicacion, "ubicacion es obligatoria");
    }

    public String getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public Ubicacion getUbicacion() {
        return ubicacion;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Zona zona)) {
            return false;
        }
        return id.equals(zona.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
