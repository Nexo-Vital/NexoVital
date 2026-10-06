package co.edu.escuelaing.nexovital.recursos.domain.model;

/**
 * Insumo que un administrador declara para su centro: el nombre, cuánto tiene
 * hoy ({@code disponible}) y el máximo que el centro necesita
 * ({@code requerido}).
 *
 * <p>Los números son envoltorios a propósito: un campo ausente llega como
 * {@code null} y {@link #validar()} lo rechaza con un mensaje que lo nombra, en
 * vez de que un primitivo lo enmascare como {@code 0}.
 */
public record NuevoItemInventario(String nombre, Integer disponible, Integer requerido) {

    /** Longitud de la columna {@code nombre} de {@code inventario_items}. */
    public static final int LONGITUD_MAXIMA_NOMBRE = 120;

    /** Tope de cordura para una cantidad; evita desbordes al sumar donaciones. */
    public static final int CANTIDAD_MAXIMA = 1_000_000;

    /**
     * @return el nombre sin espacios al inicio ni al final
     * @throws IllegalArgumentException con un mensaje en español si falta el
     *                                  nombre o una cantidad está fuera de rango
     */
    public String validar() {
        if (nombre == null || nombre.isBlank()) {
            throw new IllegalArgumentException("El nombre del insumo es obligatorio.");
        }
        String limpio = nombre.trim();
        if (limpio.length() > LONGITUD_MAXIMA_NOMBRE) {
            throw new IllegalArgumentException(
                    "El nombre del insumo no puede superar " + LONGITUD_MAXIMA_NOMBRE + " caracteres.");
        }
        if (disponible == null || disponible < 0 || disponible > CANTIDAD_MAXIMA) {
            throw new IllegalArgumentException(
                    "La cantidad actual de \"" + limpio + "\" debe ser un entero entre 0 y " + CANTIDAD_MAXIMA + ".");
        }
        if (requerido == null || requerido < 1 || requerido > CANTIDAD_MAXIMA) {
            throw new IllegalArgumentException(
                    "La cantidad máxima de \"" + limpio + "\" debe ser un entero entre 1 y " + CANTIDAD_MAXIMA + ".");
        }
        return limpio;
    }
}
