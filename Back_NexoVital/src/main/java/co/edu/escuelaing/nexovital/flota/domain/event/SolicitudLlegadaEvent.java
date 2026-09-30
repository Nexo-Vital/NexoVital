package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * The winning unit declared its arrival at the scene. Published post-commit to
 * the requester so the citizen's screen leaves the "on the way" phase; the
 * arrival is a mission milestone, not a request lifecycle state (the request
 * stays ASIGNADA).
 */
public record SolicitudLlegadaEvent(UUID solicitudId, UUID emergenciaId, String zonaId,
                                    UUID ambulanciaId, UUID solicitanteId) {
}
