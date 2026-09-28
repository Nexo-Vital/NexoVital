package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.event.PosicionActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Reports a unit's position, enforcing that the unit belongs to the acting
 * driver (D-T2). It mirrors the accept/reject/arrival actor check: the client
 * sends the unit id, so the server verifies ownership before writing.
 *
 * <p><b>State is never touched (D-T5).</b> The write is a targeted UPDATE over
 * the position columns only; the domain {@link Ambulancia#actualizarPosicion}
 * keeps the same {@code estado}. A unit in a mission keeps moving.
 *
 * <p><b>Post-commit push (D-T3).</b> The position event is published inside the
 * transaction and the {@code FlotaPushListener} delivers it only after commit.
 *
 * <p><b>No privileged path (D-T4).</b> The driver route and the simulator call
 * this same method; the simulator resolves the unit's assigned driver and passes
 * it as the actor, so it goes through the same ownership check.
 */
@Service
public class ReportarPosicionUseCaseImpl implements ReportarPosicionUseCase {

    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public ReportarPosicionUseCaseImpl(AmbulanciaRepository ambulanciaRepository,
                                       ApplicationEventPublisher eventPublisher) {
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public Ambulancia reportarPosicion(UUID ambulanciaId, UUID conductorId,
                                       double lat, double lng, Integer heading,
                                       FuentePosicion fuente) {
        Ambulancia ambulancia = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new AmbulanciaNoDisponibleException(ambulanciaId));

        // The unit must belong to the acting driver. A unit without a driver
        // matches nobody (Objects.equals(null, x) is false), so it can never be
        // moved on someone's behalf.
        if (!Objects.equals(ambulancia.getConductorId(), conductorId)) {
            throw new AmbulanciaAjenaException(ambulanciaId);
        }

        // Domain snapshot: same identity, driver and state; new coordinates.
        Ambulancia actualizada = ambulancia.actualizarPosicion(lat, lng);

        // The state stays untouched by construction: the UPDATE only writes
        // lat/lng (and the version).
        int filas = ambulanciaRepository.actualizarPosicionAtomica(ambulanciaId, lat, lng);
        if (filas == 0) {
            throw new AmbulanciaNoDisponibleException(ambulanciaId);
        }

        eventPublisher.publishEvent(new PosicionActualizadaEvent(
                ambulanciaId, lat, lng, actualizada.getEstado(), heading, fuente));

        return actualizada;
    }
}
