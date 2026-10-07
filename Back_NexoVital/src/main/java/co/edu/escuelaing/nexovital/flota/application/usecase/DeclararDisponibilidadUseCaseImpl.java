package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudEnCursoException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DeclararDisponibilidadUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Moves a driver's own unit between {@code DISPONIBLE} and {@code MANTENIMIENTO}
 * (EP-04.F2.US1). {@code MANTENIMIENTO} is the unit state behind the driver's
 * "Fuera de servicio": the broadcast only reaches {@code DISPONIBLE} units, so a
 * unit out of service stops receiving requests without any other rule.
 *
 * <p><b>One conditional UPDATE.</b> The change is the same compare-and-swap the
 * accept and the finish use ({@code transicionAtomicaEstado}): it only applies
 * while the unit is still in the state it is leaving.
 *
 * <p><b>Race with accept.</b> Going out of service requires the unit to be
 * {@code DISPONIBLE}; accepting a request requires the same and moves it to
 * {@code EN_MISION}. Both compete for the row, so exactly one applies: either
 * the unit takes the mission and this command answers "in service", or the unit
 * goes out of service and the accept gets 0 rows and is refused. A unit can
 * never be out of service and in a mission.
 *
 * <p>The state change is published like every other one: a
 * {@link FlotaActualizadaEvent} inside the transaction, delivered to
 * {@code /topic/flota} after commit with the row version. It is published only
 * when the UPDATE affected a row, so a repeated command emits nothing.
 */
@Service
public class DeclararDisponibilidadUseCaseImpl implements DeclararDisponibilidadUseCase {

    private final FlotaQueryPort flotaQueryPort;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public DeclararDisponibilidadUseCaseImpl(FlotaQueryPort flotaQueryPort,
                                             AmbulanciaRepository ambulanciaRepository,
                                             ApplicationEventPublisher eventPublisher) {
        this.flotaQueryPort = flotaQueryPort;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public Optional<Ambulancia> declarar(UUID conductorId, boolean disponible) {
        Optional<Ambulancia> propia = flotaQueryPort.buscarPorConductor(conductorId);
        if (propia.isEmpty()) {
            return Optional.empty();
        }
        UUID ambulanciaId = propia.get().getId();
        EstadoAmbulancia desde = disponible ? EstadoAmbulancia.MANTENIMIENTO : EstadoAmbulancia.DISPONIBLE;
        EstadoAmbulancia hacia = disponible ? EstadoAmbulancia.DISPONIBLE : EstadoAmbulancia.MANTENIMIENTO;

        if (ambulanciaRepository.transicionAtomicaEstado(ambulanciaId, desde, hacia) == 1) {
            eventPublisher.publishEvent(new FlotaActualizadaEvent(ambulanciaId, hacia));
            return ambulanciaRepository.buscarPorId(ambulanciaId);
        }
        // 0 rows: the unit was not in the state it had to leave. Either it is
        // already where the driver wants it (nothing to do), or it is attending
        // a request. Read the row to tell them apart.
        Optional<Ambulancia> actual = ambulanciaRepository.buscarPorId(ambulanciaId);
        if (actual.isPresent() && estaEnServicio(actual.get())) {
            throw new SolicitudEnCursoException(ambulanciaId);
        }
        return actual;
    }

    private static boolean estaEnServicio(Ambulancia ambulancia) {
        return ambulancia.getEstado() == EstadoAmbulancia.EN_MISION
                || ambulancia.getEstado() == EstadoAmbulancia.EN_RUTA;
    }
}
