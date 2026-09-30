package co.edu.escuelaing.nexovital.recursos.domain.port.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Output port: persistence of inventory items. Returns the domain aggregate
 * {@link ItemInventario}, never the JPA entity.
 */
public interface InventarioRepository {

    /**
     * @param centroAcopioId id of the center
     * @return the center's items; empty when it has no inventory
     */
    List<ItemInventario> listarPorCentro(UUID centroAcopioId);

    /**
     * @return every item of every center, for the center-level traffic light
     */
    List<ItemInventario> listarTodos();

    /**
     * @param centroAcopioId id of the center
     * @param itemId         id of the item
     * @return the item, or empty when it does not exist in that center
     */
    Optional<ItemInventario> buscar(UUID centroAcopioId, UUID itemId);

    /**
     * Atomic credit: ONE {@code @Modifying} JPQL update
     * ({@code SET disponible = disponible + :cantidad}). It never loads the
     * entity, so two concurrent donations cannot lose an update.
     *
     * @param centroAcopioId id of the center that owns the item
     * @param itemId         id of the item
     * @param cantidad       quantity to add; must be {@code >= 1}
     * @return {@code true} when a row was credited, {@code false} when no such
     *         item exists in that center
     */
    boolean acreditar(UUID centroAcopioId, UUID itemId, int cantidad);

    /**
     * Atomic dispatch (CAS) of the finite stock C1: ONE {@code @Modifying} JPQL
     * update conditioned to {@code disponible >= :cantidad}. It never loads the
     * entity, so the conditional {@code WHERE} makes over-allocation impossible
     * by construction: two concurrent dispatches can never take more stock than
     * there is.
     *
     * @param centroAcopioId id of the center that owns the item
     * @param itemId         id of the item
     * @param cantidad       quantity to subtract; must be {@code >= 1}
     * @return affected rows: 1 when this caller took the stock, 0 when the stock
     *         no longer covered the quantity or the item is not in that center
     */
    int transicionAtomicaDespacho(UUID centroAcopioId, UUID itemId, int cantidad);
}
