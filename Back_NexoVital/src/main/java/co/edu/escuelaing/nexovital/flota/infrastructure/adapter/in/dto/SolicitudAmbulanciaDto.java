package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Public projection of an ambulance request.
 *
 * <p>{@code ubicacion} is the pickup point and is always present. {@code
 * emergenciaId}, {@code centroAyudaId} and {@code zonaId} are nullable: a
 * standalone citizen request carries none of them.
 *
 * <p>{@code ambulanciasRechazaron} lists the units that declined the request
 * (EP-04.F2.US5). The request stays PENDIENTE for the rest; a unit that is in
 * this list can still read the request but can no longer accept it.
 */
public record SolicitudAmbulanciaDto(UUID id, UbicacionDto ubicacion, UUID emergenciaId,
                                     EstadoSolicitud estado, UUID centroAyudaId, String zonaId,
                                     Instant solicitadaEn, Instant timeoutEn,
                                     List<UUID> ambulanciasNotificadas, UUID ambulanciaAsignadaId,
                                     Instant llegadaEn, List<UUID> ambulanciasRechazaron) {

    public static SolicitudAmbulanciaDto fromDomain(SolicitudAmbulancia solicitud) {
        return new SolicitudAmbulanciaDto(
                solicitud.getId(),
                new UbicacionDto(solicitud.getLat(), solicitud.getLng()),
                solicitud.getEmergenciaId(),
                solicitud.getEstado(),
                solicitud.getCentroAyudaId(),
                solicitud.getZonaId(),
                solicitud.getSolicitadaEn(),
                solicitud.getTimeoutEn(),
                solicitud.getAmbulanciasNotificadas(),
                solicitud.getAmbulanciaAsignadaId(),
                solicitud.getLlegadaEn(),
                solicitud.getAmbulanciasRechazaron());
    }
}
