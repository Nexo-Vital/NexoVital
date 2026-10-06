package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * Reads the authoritative detail of an ambulance request (EP-04.F2.US3).
 *
 * <p>The request is a PRIVATE resource: the caller may read it only when they
 * are the requester, the driver of the assigned unit, or the driver of a
 * notified unit. The HTTP adapter stays thin and delegates the whole
 * authorization to this use case; any other authenticated user is refused with
 * {@code SolicitudAjenaException}.
 */
public interface ConsultarDetalleSolicitudUseCase {

    SolicitudAmbulancia consultar(UUID solicitudId, UUID usuarioId);
}
