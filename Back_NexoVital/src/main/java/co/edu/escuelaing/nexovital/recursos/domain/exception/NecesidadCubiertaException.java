package co.edu.escuelaing.nexovital.recursos.domain.exception;

import java.util.UUID;

/**
 * The need of an item is already covered ({@code disponible >= requerido}): a
 * donation has nothing left to fill. It is what the donor who loses the race
 * receives when another donor completed the need first. The controller
 * translates it to {@code 409 NECESIDAD_CUBIERTA}.
 */
public class NecesidadCubiertaException extends RuntimeException {

    private final UUID centroAcopioId;
    private final UUID itemId;
    private final String nombre;

    public NecesidadCubiertaException(UUID centroAcopioId, UUID itemId, String nombre) {
        super("The need for item " + itemId + " (" + nombre + ") at center " + centroAcopioId
                + " is already covered");
        this.centroAcopioId = centroAcopioId;
        this.itemId = itemId;
        this.nombre = nombre;
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
}
