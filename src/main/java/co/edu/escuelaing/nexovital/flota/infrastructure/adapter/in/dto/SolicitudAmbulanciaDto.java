package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Public projection of an ambulance request. */
public record SolicitudAmbulanciaDto(UUID id, UUID emergenciaId, EstadoSolicitud estado,
                                     UUID centroAyudaId, String zonaId, Instant solicitadaEn,
                                     Instant timeoutEn, List<UUID> ambulanciasNotificadas,
                                     UUID ambulanciaAsignadaId, Instant llegadaEn) {

    public static SolicitudAmbulanciaDto fromDomain(SolicitudAmbulancia solicitud) {
        return new SolicitudAmbulanciaDto(
                solicitud.getId(),
                solicitud.getEmergenciaId(),
                solicitud.getEstado(),
                solicitud.getCentroAyudaId(),
                solicitud.getZonaId(),
                solicitud.getSolicitadaEn(),
                solicitud.getTimeoutEn(),
                solicitud.getAmbulanciasNotificadas(),
                solicitud.getAmbulanciaAsignadaId(),
                solicitud.getLlegadaEn());
    }
}
