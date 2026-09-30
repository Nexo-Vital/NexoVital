package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * The requester withdraws their own ambulance request while nobody accepted it
 * (PENDIENTE → CANCELADA).
 *
 * <p>Two refusals, both honest and never a 500:
 * <ul>
 *   <li>the request is already assigned/closed → 409, the ambulance is on its
 *       way and cannot be called back;</li>
 *   <li>the caller is not the request's own {@code solicitanteId} → 403, only
 *       the requester may cancel their request.</li>
 * </ul>
 *
 * <p>The identity is the requester's own user id, exactly as confirmation uses
 * it: {@code centroAyudaId} is an organization id the principal cannot resolve,
 * so it never identifies a {@code Usuario}.
 */
public interface CancelarSolicitudUseCase {

    SolicitudAmbulancia cancelar(UUID solicitudId, UUID solicitanteId);
}
