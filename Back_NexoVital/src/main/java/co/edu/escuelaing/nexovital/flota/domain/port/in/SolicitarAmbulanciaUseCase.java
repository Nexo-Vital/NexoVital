package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
import java.util.UUID;

/**
 * Creates a PENDIENTE request and notifies every available unit (AC1).
 *
 * <p>The request no longer depends on an affected zone: the dispatch broadcasts
 * to ALL available units, so the zone is optional context and never a filter.
 */
public interface SolicitarAmbulanciaUseCase {

    /**
     * @param lat           pickup point latitude; mandatory and finite
     * @param lng           pickup point longitude; mandatory and finite
     * @param emergenciaId  optional emergency reference, or null
     * @param centroAyudaId optional aid-center reference, or null
     * @param zonaId        optional zone context, or null
     * @param solicitanteId id of the user who raises the request; the lifecycle
     *                      is delivered to this user so they can track it
     * @param timeoutEn     accept deadline. The HTTP layer always passes null, so
     *                      the server fixes it from its own clock and its
     *                      configured window (EP-04.F2.US6); an explicit value is
     *                      only for internal callers, such as tests that need an
     *                      already expired request
     * @param direccion     optional readable pickup address the citizen sent, or null
     */
    SolicitudAmbulancia solicitar(double lat, double lng, UUID emergenciaId, UUID centroAyudaId,
                                  String zonaId, UUID solicitanteId, Instant timeoutEn, String direccion);

    /** A request without a readable address. */
    default SolicitudAmbulancia solicitar(double lat, double lng, UUID emergenciaId, UUID centroAyudaId,
                                          String zonaId, UUID solicitanteId, Instant timeoutEn) {
        return solicitar(lat, lng, emergenciaId, centroAyudaId, zonaId, solicitanteId, timeoutEn, null);
    }
}
