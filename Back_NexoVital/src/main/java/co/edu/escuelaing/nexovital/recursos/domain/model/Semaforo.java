package co.edu.escuelaing.nexovital.recursos.domain.model;

/**
 * Traffic-light level of an inventory item (C1, EP-03).
 *
 * <p>Four levels (EP-02.F2.US1): {@code ROJO} (&lt; 35 %), {@code AMARILLO}
 * (35 % to &lt; 70 %), {@code VERDE} (70 % to &lt; 100 %) and {@code COMPLETO}
 * (100 % covered, or no declared requirement, so there is nothing left to ask
 * for). {@code COMPLETO} extends the OpenAPI enum
 * ({@code Semaforo: [ROJO, AMARILLO, VERDE]}), which must be updated in
 * {@code openapi.yaml}.
 *
 * <p>{@code ROJO} is the most severe level: a center is only as healthy as its
 * scarcest item, so {@link #masGrave(Semaforo)} picks the worst one.
 */
public enum Semaforo {

    ROJO,
    AMARILLO,
    VERDE,
    COMPLETO;

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
            case COMPLETO -> 0;
        };
    }
}
