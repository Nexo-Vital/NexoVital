package co.edu.escuelaing.nexovital.auditoria.domain.model;

import java.time.Instant;
import java.util.UUID;

/**
 * Criterios de consulta de la bitácora de peticiones (T15). Todos son
 * opcionales y se combinan con Y.
 *
 * <ul>
 *   <li>{@code traceId}: una petición concreta (el {@code X-Request-Id} que
 *       devolvió el servidor).</li>
 *   <li>{@code usuarioId}: todo lo que hizo un usuario.</li>
 *   <li>{@code recursoId}: una emergencia o un centro. Trae las peticiones cuya
 *       ruta lleva ese id y las que originaron una acción crítica sobre él
 *       (por ejemplo, el {@code POST /emergencias} que la creó, cuya ruta no
 *       tiene id).</li>
 *   <li>{@code desde}/{@code hasta}: ventana de tiempo, inclusive.</li>
 * </ul>
 *
 * @param limite máximo de filas; el caso de uso lo acota
 */
public record FiltroBitacora(
        String traceId,
        UUID usuarioId,
        UUID recursoId,
        Instant desde,
        Instant hasta,
        int limite) {
}
