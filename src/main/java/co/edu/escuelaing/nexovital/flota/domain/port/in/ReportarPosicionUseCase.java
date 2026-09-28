package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.UUID;

/**
 * Reports the live position of a fleet unit (EP-04.F1.US1).
 *
 * <p>Position is data, not a state: a report persists the coordinates and NEVER
 * changes the unit's {@code EstadoAmbulancia} (D-T5).
 *
 * <p><b>One entry point for both actors.</b> The driver's REST route and the
 * demo simulator call the SAME method, so there is no privileged path that skips
 * the ownership check or the post-commit push. The simulator resolves the unit's
 * assigned driver and reports as that driver, with
 * {@link FuentePosicion#SIMULADA}; the driver route always reports as
 * {@link FuentePosicion#DEVICE}. A driver can never select the source: the
 * inbound adapter hardcodes it.
 */
public interface ReportarPosicionUseCase {

    /**
     * Persists {@code lat}/{@code lng} for the unit and publishes the position
     * after commit.
     *
     * @param ambulanciaId the unit the caller claims to drive
     * @param conductorId the authenticated driver, or the unit's assigned driver
     *                    when the simulator reports on its behalf
     * @param lat new latitude
     * @param lng new longitude
     * @param heading degrees clockwise from north, or {@code null} when unknown
     * @param fuente who produced the report
     * @return the updated unit (its state is unchanged)
     * @throws co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaAjenaException
     *         if the unit does not belong to {@code conductorId}
     * @throws co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException
     *         if the unit does not exist
     */
    Ambulancia reportarPosicion(UUID ambulanciaId, UUID conductorId,
                                double lat, double lng, Integer heading,
                                FuentePosicion fuente);
}
