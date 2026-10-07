package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.Optional;
import java.util.UUID;

/**
 * Connection of a driver's OWN unit to the service (EP-04.F2.US1, D3 and D4).
 * Only a connected unit receives new requests.
 *
 * <p>The unit is always resolved from the authenticated driver, exactly as
 * {@code GET /api/v1/flota/ambulancias/mia}: the client never sends a unit id,
 * so it cannot connect or disconnect someone else's unit.
 */
public interface GestionarConexionUnidadUseCase {

    /**
     * Connects the driver's unit. Repeatable: connecting a unit that is already
     * connected changes nothing and publishes nothing.
     *
     * @return the unit as it is after the command, or empty when the driver
     *         drives no unit
     */
    Optional<Ambulancia> conectar(UUID conductorId);

    /**
     * Disconnects the driver's unit. Repeatable: disconnecting a unit that is
     * already disconnected changes nothing and publishes nothing.
     *
     * @return the unit as it is after the command, or empty when the driver
     *         drives no unit
     * @throws co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudEnCursoException
     *         if the unit is attending a request
     */
    Optional<Ambulancia> desconectar(UUID conductorId);

    /**
     * Disconnects the driver's unit because the driver's last realtime session
     * ended (closed tab, page reload, logout or network cut). It never fails: a
     * unit that is attending a request simply stays connected.
     *
     * @return {@code true} when this call disconnected the unit
     */
    boolean desconectarPorCierreDeSesion(UUID conductorId);
}
