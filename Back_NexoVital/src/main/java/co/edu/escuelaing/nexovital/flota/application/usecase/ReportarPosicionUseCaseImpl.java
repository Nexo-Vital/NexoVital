package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.event.PosicionActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SenalRecuperadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
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
 * <p><b>Signal (EP-04.F1.US1, D4).</b> The same UPDATE stamps the report
 * instant and its source and clears {@code sinSenal}: a unit that reports has
 * signal again, in the very write that moves it. When that write is the one
 * that brings the signal back, a {@link SenalRecuperadaEvent} is published too:
 * a unit without signal is not offered new requests, so on recovery it must be
 * offered the ones that are still open (EP-04.F2.US1).
 *
 * <p><b>The device wins over the simulator (D3).</b> A simulated report is
 * written with a conditional UPDATE that only applies while no real device owns
 * the unit. When it affects 0 rows nothing is published: the device position
 * stands.
 *
 * <p><b>Published state is re-read (EP-04.F1.US4).</b> The {@code estado} and
 * the {@code version} the event carries are read AFTER the UPDATE, under the row
 * lock, never taken from the pre-write snapshot: a report racing with an accept
 * must not announce a unit as available once it is in a mission, and the version
 * is exactly the one this write produced (D6).
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
    private final Clock clock;

    public ReportarPosicionUseCaseImpl(AmbulanciaRepository ambulanciaRepository,
                                       ApplicationEventPublisher eventPublisher,
                                       Clock clock) {
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
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

        // Domain validation of the coordinates (finite numbers). The snapshot it
        // returns is NOT what gets published: its state is the one read above,
        // which may already be stale (see the re-read below).
        ambulancia.actualizarPosicion(lat, lng);

        Instant ahora = Instant.now(clock);

        // The state stays untouched by construction: the UPDATE only writes the
        // position columns, the report instant, its source, sinSenal = false and
        // the version.
        int filas;
        if (fuente == FuentePosicion.SIMULADA) {
            // Conditional: it does not apply to a unit a real device owns (D3).
            filas = ambulanciaRepository.actualizarPosicionSimuladaAtomica(
                    ambulanciaId, lat, lng, ahora);
            if (filas == 0) {
                // A device took the unit between the simulator's read and this
                // write. Nothing was written, so nothing is published.
                return ambulancia;
            }
        } else {
            filas = ambulanciaRepository.actualizarPosicionAtomica(
                    ambulanciaId, lat, lng, fuente, ahora);
            if (filas == 0) {
                throw new AmbulanciaNoDisponibleException(ambulanciaId);
            }
        }

        // Re-read AFTER the UPDATE (EP-04.F1.US4 / EP-04.F2.US7). The state read
        // at the top can be stale: an accept may flip the unit to EN_MISION
        // between that read and this write, and the position frame would then
        // reach the map saying AVAILABLE *after* the ASSIGNED frame, painting a
        // busy unit as free. From the UPDATE on, this transaction holds the row
        // lock, so a concurrent state transition either committed before (and is
        // visible here) or waits until this commit: the state and the version
        // read now are the ones the row has when this report commits.
        Ambulancia persistida = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new AmbulanciaNoDisponibleException(ambulanciaId));

        eventPublisher.publishEvent(new PosicionActualizadaEvent(
                ambulanciaId, lat, lng, persistida.getEstado(), heading, fuente,
                false, ahora, persistida.getVersion()));
        // The snapshot read at the top is the state BEFORE this write: if it had
        // no signal, this is the report that brings it back.
        if (ambulancia.isSinSenal()) {
            eventPublisher.publishEvent(new SenalRecuperadaEvent(ambulanciaId));
        }

        return persistida;
    }
}
