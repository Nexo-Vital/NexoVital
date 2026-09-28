package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/**
 * The requester confirms the assigned unit (ASIGNADA → CONFIRMADA).
 *
 * <p>The caller is the CITIZEN who raised the request: the request stores the
 * requester's own user id ({@code solicitanteId}), which is the only identity on
 * the request that maps to an authenticated {@code Usuario}. The aid center the
 * request points at is an ORGANIZATION id and {@code Usuario} carries no
 * organization link, so the center cannot be resolved from the principal (see
 * {@code ConfirmarSolicitudUseCaseImpl}).
 */
public interface ConfirmarSolicitudUseCase {

    SolicitudAmbulancia confirmar(UUID solicitudId, UUID solicitanteId);
}
