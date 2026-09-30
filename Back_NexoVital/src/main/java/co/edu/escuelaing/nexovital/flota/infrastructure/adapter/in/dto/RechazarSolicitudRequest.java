package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import java.util.UUID;

/** Body of {@code POST /api/v1/solicitudes/{id}/reject}. */
public record RechazarSolicitudRequest(UUID ambulanciaId) {
}
