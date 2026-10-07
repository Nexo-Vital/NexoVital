package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.List;
import java.util.UUID;

/**
 * Offers the requests that are still open to a unit that has just become able
 * to receive them (EP-04.F2.US1).
 *
 * <p>A request is broadcast once, to the units that can receive it at that
 * instant. A unit that was busy, out of service, disconnected or without signal
 * is left out, and used to stay out even after it became available again while
 * the request was still waiting. This use case closes that gap: when a unit
 * becomes eligible, it joins the notified units of every request that is still
 * PENDIENTE and whose accept window is still open.
 *
 * <p>The window is never extended: the unit gets the time the request has left.
 */
public interface IncorporarUnidadASolicitudesAbiertasUseCase {

    /**
     * Adds {@code ambulanciaId} to the notified units of every open request it
     * was not notified of, provided the unit can receive requests right now.
     *
     * @return the requests the unit was actually added to, oldest first, each
     *         one as it is after the change; empty when the unit is not eligible
     *         or nothing is open
     */
    List<SolicitudAmbulancia> incorporar(UUID ambulanciaId);
}
