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
     */
    SolicitudAmbulancia solicitar(double lat, double lng, UUID emergenciaId, UUID centroAyudaId,
                                  String zonaId, UUID solicitanteId, Instant timeoutEn);
}
