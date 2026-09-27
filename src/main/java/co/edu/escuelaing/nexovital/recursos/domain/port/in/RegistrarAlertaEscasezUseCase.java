package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import java.util.UUID;

/**
 * Input port of {@code recursos}: raise (or update) the shortage alert left by
 * a rejected dispatch.
 *
 * <p>It is invoked from the rejection branch of the dispatch. Because that
 * branch throws and Spring rolls the surrounding transaction back, the
 * implementation MUST run in its own transaction (FA-6): see
 * {@code RegistrarAlertaEscasezUseCaseImpl}.
 */
public interface RegistrarAlertaEscasezUseCase {

    /**
     * Records the demand of a rejected dispatch on the item of a center.
     *
     * @param centroAcopioId   id of the center that rejected the request
     * @param itemId           id of the requested item
     * @param nombre           name of the resource, so the alert can name it
     * @param cantidadSolicitada units requested by the rejected dispatch
     * @param disponibleActual stock available when the dispatch was rejected
     */
    void registrar(UUID centroAcopioId, UUID itemId, String nombre, int cantidadSolicitada, int disponibleActual);
}
