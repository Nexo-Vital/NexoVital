package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.DonacionAceptada;

import java.util.UUID;

/**
 * Input port: donate to one item of an aid center.
 *
 * <p>A donation can never exceed what the center still needs
 * ({@code requerido - disponible}). The credit is ONE conditional statement in
 * the database, so concurrent donors cannot overshoot the requirement: the
 * first one takes what fits, the next one only the remainder, and once the
 * need is covered the donation is rejected.
 */
public interface RegistrarDonacionUseCase {

    /**
     * @param centroAcopioId id of the aid center
     * @param itemId         id of the item being credited
     * @param cantidad       quantity offered; must be {@code >= 1}
     * @return the item after the credit and the quantity actually accepted
     *         ({@code min(cantidad, faltante)})
     * @throws IllegalArgumentException when {@code cantidad < 1}
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException
     *         when no center exists with that id
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException
     *         when no such item exists in that center
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.NecesidadCubiertaException
     *         when the item has nothing left to cover
     */
    DonacionAceptada donar(UUID centroAcopioId, UUID itemId, int cantidad);
}
