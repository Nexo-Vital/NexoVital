package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;

import java.util.UUID;

/** First accept wins the CAS; the rest lose (AC2). */
public interface AceptarSolicitudUseCase {

    ResultadoAceptarSolicitud aceptar(UUID solicitudId, UUID ambulanciaId);
}
