package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Shortage alert of a supply center: the uncovered demand a rejected dispatch
 * left behind (EP-03.F1.US5, Azure 225).
 *
 * <p>It stores the <b>demand</b> (how many units were requested), never a
 * frozen deficit. A frozen number would lie the moment someone donates one
 * unit: storing {@code 5} available and {@code 8} requested must display a
 * missing quantity of {@code 3}, and {@code 2} after a donation of one. The
 * current missing quantity is therefore computed against the stock read at
 * query time, never persisted (FA-2).
 *
 * <p>The field is named {@code cantidadSolicitada}, NOT {@code requerido}:
 * {@link ItemInventario#getRequerido()} is the traffic-light threshold and
 * conflating the two would mix two unrelated concepts (FA-2).
 *
 * <p>The alert is <b>active while {@code disponibleActual <
 * cantidadSolicitada}}</b> and clears itself once a donation covers the demand
 * (FA-3). The record survives after that as traceability, with its creation
 * date.
 *
 * <p>Immutable and framework-free, like {@link ItemInventario}.
 */
public final class AlertaEscasez {

    private final UUID id;
    private final UUID centroAcopioId;
    private final UUID itemId;
    private final String nombre;
    private final int cantidadSolicitada;
    private final Instant creadaEn;

    public AlertaEscasez(UUID id,
                         UUID centroAcopioId,
                         UUID itemId,
                         String nombre,
                         int cantidadSolicitada,
                         Instant creadaEn) {
        this.id = Objects.requireNonNull(id, "id is required");
        this.centroAcopioId = Objects.requireNonNull(centroAcopioId, "centroAcopioId is required");
        this.itemId = Objects.requireNonNull(itemId, "itemId is required");
        this.nombre = Objects.requireNonNull(nombre, "nombre is required");
        if (cantidadSolicitada < 1) {
            throw new IllegalArgumentException("cantidadSolicitada must be >= 1: " + cantidadSolicitada);
        }
        this.cantidadSolicitada = cantidadSolicitada;
        this.creadaEn = Objects.requireNonNull(creadaEn, "creadaEn is required");
    }

    /**
     * Raises a brand-new alert for a rejected dispatch.
     *
     * @return a new alert with a generated identity
     */
    public static AlertaEscasez crear(UUID centroAcopioId,
                                      UUID itemId,
                                      String nombre,
                                      int cantidadSolicitada,
                                      Instant creadaEn) {
        return new AlertaEscasez(UUID.randomUUID(), centroAcopioId, itemId, nombre, cantidadSolicitada, creadaEn);
    }

    /**
     * An alert is active exactly while the current stock still falls short of
     * the recorded demand (FD-3 clearing rule, FA-3).
     *
     * @param disponibleActual stock available at read time
     * @return {@code true} when the demand is still uncovered
     */
    public boolean estaActiva(int disponibleActual) {
        return disponibleActual < cantidadSolicitada;
    }

    /**
     * The quantity a donor still has to cover. Positive exactly while the alert
     * is active (FA-2).
     *
     * @param disponibleActual stock available at read time
     * @return {@code cantidadSolicitada - disponibleActual}, never negative
     */
    public int faltante(int disponibleActual) {
        return Math.max(0, cantidadSolicitada - disponibleActual);
    }

    /**
     * FA-4: when a later rejection asks for MORE of the same item, the larger
     * demand wins. A smaller rejection must never lower an already-raised
     * alert, so this returns {@code this} unchanged in that case.
     */
    public AlertaEscasez conMayorDemanda(int nuevaDemanda) {
        if (nuevaDemanda <= cantidadSolicitada) {
            return this;
        }
        return new AlertaEscasez(id, centroAcopioId, itemId, nombre, nuevaDemanda, creadaEn);
    }

    /**
     * Starts a fresh shortage cycle on the same record after the previous one
     * was already covered: the demand is reset to the new request and the
     * creation date marks this new episode.
     */
    public AlertaEscasez reactivar(int nuevaDemanda, Instant ahora) {
        return new AlertaEscasez(id, centroAcopioId, itemId, nombre, nuevaDemanda,
                Objects.requireNonNull(ahora, "ahora is required"));
    }

    public UUID getId() {
        return id;
    }

    public UUID getCentroAcopioId() {
        return centroAcopioId;
    }

    public UUID getItemId() {
        return itemId;
    }

    public String getNombre() {
        return nombre;
    }

    public int getCantidadSolicitada() {
        return cantidadSolicitada;
    }

    public Instant getCreadaEn() {
        return creadaEn;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof AlertaEscasez otra)) {
            return false;
        }
        return id.equals(otra.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
