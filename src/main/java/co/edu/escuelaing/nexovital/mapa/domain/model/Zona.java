package co.edu.escuelaing.nexovital.mapa.domain.model;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

import java.util.List;
import java.util.Objects;

/**
 * Agregado de una zona del mapa: una localidad de Bogotá con su contorno y su
 * punto de referencia. Inmutable y sin dependencias de framework, igual que
 * {@link co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion}.
 *
 * <p>El {@code id} es el mismo valor que las organizaciones usan en su
 * {@code zonaId}: una referencia simple entre módulos, sin clave foránea.
 *
 * <p>El {@code contorno} es la lista ordenada de vértices (lat/lng) que dibuja
 * la localidad como ÁREA, no como punto: es lo que permite ver hasta dónde
 * llega la zona y comprobar si un centro cae dentro. Sin PostGIS ni tipo
 * espacial, el contorno es una lista de {@link Ubicacion}. La {@code ubicacion}
 * se conserva como centro de referencia (encuadre/etiqueta), no como
 * representación de la zona.
 *
 * <p>Los contornos sembrados son polígonos SIMPLIFICADOS y APROXIMADOS de
 * demostración: NO son el límite oficial de la localidad. El detalle y la
 * declaración completa están en el catálogo del seeder.
 */
public final class Zona {

    private final String id;
    private final String nombre;
    private final Ubicacion ubicacion;
    private final List<Ubicacion> contorno;

    public Zona(String id, String nombre, Ubicacion ubicacion, List<Ubicacion> contorno) {
        this.id = Objects.requireNonNull(id, "id es obligatorio");
        this.nombre = Objects.requireNonNull(nombre, "nombre es obligatorio");
        this.ubicacion = Objects.requireNonNull(ubicacion, "ubicacion es obligatoria");
        this.contorno = List.copyOf(Objects.requireNonNull(contorno, "contorno es obligatorio"));
    }

    public String getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    /** Punto de referencia de la zona (encuadre/etiqueta); no es la zona entera. */
    public Ubicacion getUbicacion() {
        return ubicacion;
    }

    /** Vértices ordenados del contorno; el polígono es la zona como área. */
    public List<Ubicacion> getContorno() {
        return contorno;
    }

    /**
     * Indica si el punto cae DENTRO del contorno de esta zona (algoritmo de
     * ray casting sobre lat/lng).
     *
     * <p>Un contorno con menos de tres vértices no encierra área, así que nunca
     * contiene un punto. Es la comprobación que hace verificable que cada centro
     * sembrado pertenezca a la localidad que declara.
     *
     * @param punto punto a comprobar
     * @return {@code true} si el punto está dentro del polígono
     */
    public boolean contiene(Ubicacion punto) {
        Objects.requireNonNull(punto, "punto es obligatorio");
        if (contorno.size() < 3) {
            return false;
        }
        boolean dentro = false;
        for (int i = 0, j = contorno.size() - 1; i < contorno.size(); j = i++) {
            double latI = contorno.get(i).lat();
            double lngI = contorno.get(i).lng();
            double latJ = contorno.get(j).lat();
            double lngJ = contorno.get(j).lng();
            // El guardia descarta los lados horizontales, así que lngJ != lngI
            // cuando se evalúa la división (no hay división por cero).
            boolean cruza = (lngI > punto.lng()) != (lngJ > punto.lng())
                    && punto.lat() < (latJ - latI) * (punto.lng() - lngI) / (lngJ - lngI) + latI;
            if (cruza) {
                dentro = !dentro;
            }
        }
        return dentro;
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
