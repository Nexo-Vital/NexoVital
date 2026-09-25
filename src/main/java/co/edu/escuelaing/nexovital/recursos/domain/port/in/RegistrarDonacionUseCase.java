package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;

import java.util.UUID;

/**
 * Input port: credit a donation to one item of an aid center.
 *
 * <p>A donation credits stock immediately to the quantity the citizen chose;
 * there is no confirmation step and no {@code Donacion} entity with state. The
 * stock only INCREMENTS, so C1 ("stock never negative") cannot be violated by
 * this operation; the increment is still atomic in the database.
 */
public interface RegistrarDonacionUseCase {

    /**
     * @param centroAcopioId id of the aid center
     * @param itemId         id of the item being credited
     * @param cantidad       quantity to add; must be {@code >= 1}
     * @return the item after the atomic credit
     * @throws IllegalArgumentException when {@code cantidad < 1}
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException
     *         when no center exists with that id
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException
     *         when no such item exists in that center
     */
    ItemInventario donar(UUID centroAcopioId, UUID itemId, int cantidad);
}
