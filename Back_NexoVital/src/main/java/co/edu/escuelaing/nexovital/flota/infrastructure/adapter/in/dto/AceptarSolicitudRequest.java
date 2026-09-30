package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import java.util.UUID;

/** Body of {@code POST /api/v1/solicitudes/{id}/accept}. */
public record AceptarSolicitudRequest(UUID ambulanciaId) {
}
