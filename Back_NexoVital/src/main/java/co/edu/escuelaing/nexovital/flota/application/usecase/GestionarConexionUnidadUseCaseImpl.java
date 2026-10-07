package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.event.ConexionUnidadEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudEnCursoException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.GestionarConexionUnidadUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Connects and disconnects a driver's own unit (EP-04.F2.US1, D3 and D4).
 *
 * <p><b>No read-modify-write.</b> Each command is ONE conditional UPDATE. The
 * unit is read first only to resolve its id from the driver; the decision is
 * taken by the database:
 * <ul>
 *   <li>connect applies only while the unit is disconnected;</li>
 *   <li>disconnect applies only while the unit is connected and NOT in
 *       service.</li>
 * </ul>
 *
 * <p><b>Race with accept.</b> Accepting a request occupies the unit with an
 * UPDATE that requires {@code conectada = true}; disconnecting requires the unit
 * not to be in service. Both statements compete for the same row, so exactly one
 * of them applies and a unit can never be in a mission and disconnected.
 *
 * <p>The event is published inside the transaction and only when the UPDATE
 * affected a row, so a repeated command does not emit a frame. It is delivered
 * after commit by {@link ConexionPushListener}.
 */
@Service
public class GestionarConexionUnidadUseCaseImpl implements GestionarConexionUnidadUseCase {

    private final FlotaQueryPort flotaQueryPort;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public GestionarConexionUnidadUseCaseImpl(FlotaQueryPort flotaQueryPort,
                                              AmbulanciaRepository ambulanciaRepository,
                                              ApplicationEventPublisher eventPublisher) {
        this.flotaQueryPort = flotaQueryPort;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public Optional<Ambulancia> conectar(UUID conductorId) {
        Optional<Ambulancia> propia = flotaQueryPort.buscarPorConductor(conductorId);
        if (propia.isEmpty()) {
            return Optional.empty();
        }
        UUID ambulanciaId = propia.get().getId();
        if (ambulanciaRepository.conectarAtomica(ambulanciaId) == 1) {
            eventPublisher.publishEvent(new ConexionUnidadEvent(ambulanciaId));
        }
        // Read after the UPDATE: the response is the row as it is now.
        return ambulanciaRepository.buscarPorId(ambulanciaId);
    }

    @Override
    @Transactional
    public Optional<Ambulancia> desconectar(UUID conductorId) {
        Optional<Ambulancia> propia = flotaQueryPort.buscarPorConductor(conductorId);
        if (propia.isEmpty()) {
            return Optional.empty();
        }
        UUID ambulanciaId = propia.get().getId();
        if (ambulanciaRepository.desconectarAtomica(ambulanciaId) == 1) {
            eventPublisher.publishEvent(new ConexionUnidadEvent(ambulanciaId));
            return ambulanciaRepository.buscarPorId(ambulanciaId);
        }
        // 0 rows: either the unit was already disconnected (nothing to do) or it
        // is in service. Read the row to tell them apart.
        Optional<Ambulancia> actual = ambulanciaRepository.buscarPorId(ambulanciaId);
        if (actual.isPresent() && actual.get().isConectada() && estaEnServicio(actual.get())) {
            throw new SolicitudEnCursoException(ambulanciaId);
        }
        return actual;
    }

    @Override
    @Transactional
    public boolean desconectarPorCierreDeSesion(UUID conductorId) {
        Optional<Ambulancia> propia = flotaQueryPort.buscarPorConductor(conductorId);
        if (propia.isEmpty()) {
            return false;
        }
        UUID ambulanciaId = propia.get().getId();
        // The same conditional UPDATE as the manual command. A unit in service
        // yields 0 rows and stays connected: closing the tab cannot disconnect a
        // unit that is attending a request.
        if (ambulanciaRepository.desconectarAtomica(ambulanciaId) == 0) {
            return false;
        }
        eventPublisher.publishEvent(new ConexionUnidadEvent(ambulanciaId));
        return true;
    }

    private static boolean estaEnServicio(Ambulancia ambulancia) {
        return ambulancia.getEstado() == EstadoAmbulancia.EN_MISION
                || ambulancia.getEstado() == EstadoAmbulancia.EN_RUTA;
    }
}
