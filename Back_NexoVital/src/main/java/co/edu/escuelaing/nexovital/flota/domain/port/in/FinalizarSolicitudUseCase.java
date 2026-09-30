package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * The assigned driver finishes the service: the request closes and the unit
 * returns to available in the same operation (EP-04.F2.US6/US11).
 *
 * <p>The unit must be the one assigned to the request and must belong to the
 * authenticated driver, mirroring accept/reject/arrival, so a driver cannot
 * close another unit's mission.
 */
public interface FinalizarSolicitudUseCase {

    SolicitudAmbulancia finalizar(UUID solicitudId, UUID ambulanciaId, UUID conductorId);
}
