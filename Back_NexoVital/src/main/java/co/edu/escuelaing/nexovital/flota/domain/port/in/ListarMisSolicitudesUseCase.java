package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.List;
import java.util.UUID;

/** Requests raised by the authenticated user, newest first. */
public interface ListarMisSolicitudesUseCase {

    List<SolicitudAmbulancia> listarActivas(UUID solicitanteId);

    /** Attended requests: the service was finished (TOMADA). */
    List<SolicitudAmbulancia> listarAtendidas(UUID solicitanteId);
}
