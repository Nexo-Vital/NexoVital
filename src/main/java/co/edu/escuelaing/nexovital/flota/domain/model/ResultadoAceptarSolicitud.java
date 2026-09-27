package co.edu.escuelaing.nexovital.flota.domain.model;

/**
 * Result of an accept over a request. Exactly one caller wins (CAS = 1 row);
 * the rest are losers (CAS = 0 rows) and carry the current request state.
 */
public record ResultadoAceptarSolicitud(boolean ganador, SolicitudAmbulancia solicitud) {

    public static ResultadoAceptarSolicitud gano(SolicitudAmbulancia solicitud) {
        return new ResultadoAceptarSolicitud(true, solicitud);
    }

    public static ResultadoAceptarSolicitud perdio(SolicitudAmbulancia solicitud) {
        return new ResultadoAceptarSolicitud(false, solicitud);
    }
}
