package co.edu.escuelaing.nexovital.recursos.domain.exception;

import java.util.UUID;

/**
 * No inventory item exists with the given id for the given center. The
 * controller translates it to {@code 404}, mirroring {@code mapa}'s not-found
 * exceptions.
 */
public class ItemInventarioNoEncontradoException extends RuntimeException {

    public ItemInventarioNoEncontradoException(UUID centroAcopioId, UUID itemId) {
        super("Inventory item not found: " + itemId + " in center " + centroAcopioId);
    }
}
