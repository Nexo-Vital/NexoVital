package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * Detail of ONE request, as the driver who was notified of it sees it
 * (EP-04.F2.US3). The realtime notice is not replayed, so the console reads the
 * request here when the driver opens it: the pickup point, when it was raised,
 * until when it can be answered, which units were notified and its current
 * state.
 */
public interface ConsultarDetalleSolicitudUseCase {

    /**
     * The request, when it was notified to the driver's unit or it is the one
     * assigned to it. The state does not matter: a request that was taken,
     * expired or cancelled is still readable by the units it reached, so the
     * console can tell the driver why it is no longer open.
     *
     * @param solicitudId the request to read
     * @param conductorId the authenticated driver
     * @return the request
     * @throws co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException
     *         when no request has that id
     * @throws co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoNotificadaException
     *         when the driver drives no unit, or the request was neither
     *         notified nor assigned to their unit
     */
    SolicitudAmbulancia consultar(UUID solicitudId, UUID conductorId);
}
