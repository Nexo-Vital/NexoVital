package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;

import java.util.UUID;

/**
 * Input port: dispatch (decrement) stock of one item of an aid center, with the
 * C1 invariant (finite stock, no over-allocation).
 *
 * <p>The decrement is a single conditional statement in the database; it is
 * never a read-check-write in Java. A request that does not fit the available
 * stock is rejected instead of taking the stock negative.
 */
public interface DespacharStockUseCase {

    /**
     * @param centroAcopioId id of the aid center
     * @param itemId         id of the item being dispatched
     * @param cantidad       quantity to subtract; must be {@code >= 1}
     * @return the item after the atomic decrement
     * @throws IllegalArgumentException when {@code cantidad < 1}
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException
     *         when no center exists with that id
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException
     *         when no such item exists in that center
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.StockInsuficienteException
     *         when the available stock is below {@code cantidad}
     */
    ItemInventario despachar(UUID centroAcopioId, UUID itemId, int cantidad);
}
