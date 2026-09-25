package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;

import java.util.List;
import java.util.UUID;

/**
 * Input port: read the inventory of an aid center. One intention per use case.
 */
public interface ConsultarInventarioUseCase {

    /**
     * @param centroAcopioId id of the aid center
     * @return the center's items, empty when the center exists but has no
     *         declared inventory
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException
     *         when no center exists with that id
     */
    List<ItemInventario> consultar(UUID centroAcopioId);
}
