package co.edu.escuelaing.nexovital.recursos.domain.model;

/**
 * Traffic-light level of an inventory item (C1, EP-03).
 *
 * <p>The three values are the ones the OpenAPI contract fixes
 * ({@code Semaforo: [ROJO, AMARILLO, VERDE]}, {@code openapi.yaml}); no fourth
 * value is invented. {@code requerido == 0} resolves to {@link #VERDE} because a
 * center that declared no requirement has no shortage to signal (see
 * {@link ItemInventario#semaforo()}).
 *
 * <p>{@code ROJO} is the most severe level: a center is only as healthy as its
 * scarcest item, so {@link #masGrave(Semaforo)} picks the worst one.
 */
public enum Semaforo {

    ROJO,
    AMARILLO,
    VERDE;

    /**
     * @return the most severe of the two levels, so a center inherits the worst
     *         level of its items
     */
    public Semaforo masGrave(Semaforo otro) {
        return this.severidad() >= otro.severidad() ? this : otro;
    }

    private int severidad() {
        return switch (this) {
            case ROJO -> 3;
            case AMARILLO -> 2;
            case VERDE -> 1;
        };
    }
}
