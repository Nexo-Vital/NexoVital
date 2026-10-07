package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The open requests the authenticated driver can still answer (EP-04.F2.US1,
 * D6). The broker does not resend what it published while the driver had no
 * session, so the console reads them here when it connects and every time it
 * recovers the realtime channel.
 */
public interface ListarSolicitudesPendientesDeMiAmbulanciaUseCase {

    /**
     * PENDING requests, with the accept window still open, that were notified to
     * the driver's unit. Oldest first.
     *
     * <p>The list is empty when the unit cannot answer a request right now: it
     * is disconnected or it is not available. A request created while the unit
     * was not a candidate never appears, because the unit is not among its
     * notified units.
     *
     * @return the list, or empty when the driver drives no unit
     */
    Optional<List<SolicitudAmbulancia>> listar(UUID conductorId);
}
