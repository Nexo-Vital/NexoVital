package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;

import java.util.Map;
import java.util.UUID;

/**
 * Input port: the traffic light of every center that has declared inventory.
 * The {@code mapa} module reads it through its own out-port to paint each
 * center by its scarcest item without an N+1 of calls.
 */
public interface ConsultarSemaforoCentrosUseCase {

    /**
     * @return center id to worst item level. A center with no inventory is
     *         ABSENT from the map, so the caller can distinguish "not declared"
     *         from any of the three levels (never invented as {@code VERDE}).
     */
    Map<UUID, Semaforo> consultar();
}
