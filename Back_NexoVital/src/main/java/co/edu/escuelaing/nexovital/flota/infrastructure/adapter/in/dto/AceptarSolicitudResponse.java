package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

/**
 * Accept response: the request state (contract) plus the {@code ganador} flag
 * the driver pop-up uses to tell a win from a lost race.
 */
public record AceptarSolicitudResponse(boolean ganador, SolicitudAmbulanciaDto solicitud) {

    public static AceptarSolicitudResponse of(boolean ganador, SolicitudAmbulanciaDto solicitud) {
        return new AceptarSolicitudResponse(ganador, solicitud);
    }
}
