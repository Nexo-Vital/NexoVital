package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.util.Objects;
import java.util.UUID;

/**
 * Inventory item of an aid center: how much stock is available, how much is
 * required, and the traffic light derived from both. Immutable and with no
 * framework dependency, like
 * {@link co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion}.
 *
 * <p>The traffic-light rule (35 % / 70 % / 100 %), EP-02.F2.US1:
 * <ul>
 *   <li>{@link Semaforo#COMPLETO} when {@code disponible >= requerido}
 *       (including {@code requerido == 0}: no declared requirement);</li>
 *   <li>{@link Semaforo#ROJO} when {@code disponible < 0.35 * requerido};</li>
 *   <li>{@link Semaforo#AMARILLO} when
 *       {@code 0.35 * requerido <= disponible < 0.70 * requerido};</li>
 *   <li>{@link Semaforo#VERDE} otherwise (70 % IS green, hence the inclusive
 *       lower bound; exactly 35 % is yellow).</li>
 * </ul>
 * The ratios use integer arithmetic to avoid floating point.
 *
 * <p>The aggregate never mutates itself on a donation: the increment is atomic
 * in the database (one {@code @Modifying} JPQL update), never a
 * read-modify-write in Java.
 */
public final class ItemInventario {

    private final UUID id;
    private final UUID centroAcopioId;
    private final String nombre;
    private final int disponible;
    private final int requerido;
    private final String unidad;
    private final String unitDetail;

    public ItemInventario(UUID id,
                          UUID centroAcopioId,
                          String nombre,
                          int disponible,
                          int requerido,
                          String unidad,
                          String unitDetail) {
        this.id = Objects.requireNonNull(id, "id is required");
        this.centroAcopioId = Objects.requireNonNull(centroAcopioId, "centroAcopioId is required");
        this.nombre = Objects.requireNonNull(nombre, "nombre is required");
        if (disponible < 0) {
            throw new IllegalArgumentException("disponible cannot be negative: " + disponible);
        }
        if (requerido < 0) {
            throw new IllegalArgumentException("requerido cannot be negative: " + requerido);
        }
        this.disponible = disponible;
        this.requerido = requerido;
        // Optional UI detail: a live frame may not carry a unit, and the UI
        // shows the bare number rather than inventing one.
        this.unidad = unidad;
        this.unitDetail = unitDetail;
    }

    /**
     * Traffic-light level of this item. See the class Javadoc for the 35 / 70
     * rule and the {@code requerido == 0} decision.
     *
     * @return the level derived from {@code disponible / requerido}
     */
    public Semaforo semaforo() {
        if (requerido <= 0 || disponible >= requerido) {
            return Semaforo.COMPLETO;
        }
        if ((long) disponible * 100 < (long) requerido * 35) {
            return Semaforo.ROJO;
        }
        if ((long) disponible * 100 < (long) requerido * 70) {
            return Semaforo.AMARILLO;
        }
        return Semaforo.VERDE;
    }

    public UUID getId() {
        return id;
    }

    public UUID getCentroAcopioId() {
        return centroAcopioId;
    }

    public String getNombre() {
        return nombre;
    }

    public int getDisponible() {
        return disponible;
    }

    public int getRequerido() {
        return requerido;
    }

    public String getUnidad() {
        return unidad;
    }

    public String getUnitDetail() {
        return unitDetail;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof ItemInventario item)) {
            return false;
        }
        return id.equals(item.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
