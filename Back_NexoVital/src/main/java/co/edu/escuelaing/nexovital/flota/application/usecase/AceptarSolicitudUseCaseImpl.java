package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudAsignadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudYaAsignadaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudYaRechazadaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Accept with a "first accept wins" guarantee:
 * <ol>
 *   <li>read the request (fast state check for UX);</li>
 *   <li>atomic CAS PENDIENTE → ASIGNADA with the ambulance assignment (a single
 *       UPDATE conditioned on the expected state, D-F4);</li>
 *   <li>1 row = win: ambulance to EN_MISION in the SAME transaction, then the
 *       post-commit events; 0 rows = another caller won: losing result, no side
 *       effects.</li>
 * </ol>
 *
 * <p>The winner returns 200; the loser receives 409. No in-memory lock and no
 * client flag decides the winner: the server is the single source of truth.
 *
 * <p><b>Every loser reads the same reason (EP-04.F2.US4).</b> A notified unit
 * that loses is told the request is already assigned, whether it lost inside
 * the conditional UPDATE (0 rows) or arrived after the winner committed
 * ({@link SolicitudYaAsignadaException}).
 *
 * <p><b>A unit that declined cannot accept (EP-04.F2.US5).</b> Its accept is
 * refused with {@link SolicitudYaRechazadaException} before the CAS, so the
 * request stays PENDIENTE and untouched for the other notified units.
 *
 * <p><b>Only a connected unit accepts (EP-04.F2.US1, D3).</b> The UPDATE that
 * occupies the unit also requires {@code conectada = true}. Accepting and
 * disconnecting compete for the same row, so a unit can never end up in a
 * mission and disconnected: whoever commits first wins and the other one gets 0
 * rows.
 */
@Service
public class AceptarSolicitudUseCaseImpl implements AceptarSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public AceptarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                       AmbulanciaRepository ambulanciaRepository,
                                       ApplicationEventPublisher eventPublisher) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public ResultadoAceptarSolicitud aceptar(UUID solicitudId, UUID ambulanciaId, UUID conductorId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        if (solicitud.getEstado() != EstadoSolicitud.PENDIENTE) {
            // Too late: another unit already has it. A unit that WAS notified
            // is told exactly that ("ya asignada"), the same reason the loser
            // of the CAS gets. Any other closed state (cancelled, expired) and
            // any unit that was never notified keep the generic refusal.
            if (yaLaTieneOtraUnidad(solicitud, ambulanciaId)) {
                throw new SolicitudYaAsignadaException(solicitudId, solicitud.getEstado());
            }
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        Ambulancia ambulancia = validarAmbulancia(ambulanciaId);

        // Mirror the reject path: only a unit the request actually notified may
        // act on it. Without this, any driver could accept a request that was
        // never broadcast to their unit.
        if (!solicitud.fueNotificada(ambulanciaId)) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        // The unit must be the one driven by the authenticated user: the client
        // sends `ambulanciaId`, so it cannot be trusted to pick someone else's
        // unit. A unit without a driver matches nobody (Objects.equals(null, x)
        // is false), so it can never be claimed.
        if (!Objects.equals(ambulancia.getConductorId(), conductorId)) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        // A decline is final for that unit (EP-04.F2.US5): the request is still
        // open for the others, but the unit that said no cannot take it back.
        // Checked after the ownership, so only the unit's own driver learns it.
        if (solicitud.fueRechazadaPor(ambulanciaId)) {
            throw new SolicitudYaRechazadaException(solicitudId, ambulanciaId);
        }

        int filas = solicitudRepository.transicionAtomicaAsignar(
                solicitudId, ambulanciaId, EstadoSolicitud.PENDIENTE, EstadoSolicitud.ASIGNADA);

        if (filas == 0) {
            return ResultadoAceptarSolicitud.perdio(solicitud);
        }

        SolicitudAmbulancia asignada = solicitud.aceptar(ambulanciaId);

        // The unit's state change is ALSO a conditional update (D-F5/DEBT 5): the
        // pre-check above is only a fast path, not the guarantee. Two DIFFERENT
        // requests naming the SAME unit both win their own solicitud CAS, so the
        // unit row decides: the first conditional UPDATE gets 1 row, the loser
        // gets 0 and must be a 409, not a 500 from a @Version clash. The same
        // UPDATE requires the unit to be connected: a driver that disconnected a
        // moment ago also gets 0 rows. The exception rolls the transaction back,
        // so the request returns to PENDIENTE and stays open for the rest.
        int unidadOcupada = ambulanciaRepository.ocuparAtomica(ambulanciaId);
        if (unidadOcupada == 0) {
            throw new AmbulanciaNoDisponibleException(ambulanciaId);
        }

        // The notified list travels with the event: every OTHER notified unit is
        // told at once that the request is taken (SolicitudTomadaPushListener).
        // It is read from the request as it was broadcast, which never changes.
        eventPublisher.publishEvent(new SolicitudAsignadaEvent(
                solicitudId, asignada.getEmergenciaId(), asignada.getZonaId(), ambulanciaId,
                asignada.getSolicitanteId(), solicitud.getAmbulanciasNotificadas()));
        eventPublisher.publishEvent(new FlotaActualizadaEvent(ambulanciaId, EstadoAmbulancia.EN_MISION));

        return ResultadoAceptarSolicitud.gano(asignada);
    }

    /**
     * True when the request is already assigned to a unit other than the one
     * that is asking, and the one asking was notified of it.
     */
    private static boolean yaLaTieneOtraUnidad(SolicitudAmbulancia solicitud, UUID ambulanciaId) {
        UUID asignada = solicitud.getAmbulanciaAsignadaId();
        return asignada != null
                && !asignada.equals(ambulanciaId)
                && solicitud.fueNotificada(ambulanciaId);
    }

    /**
     * Loads the unit and enforces the availability precondition: available and
     * connected. It is only the fast path; the guarantee is the conditional
     * UPDATE of {@code ocuparAtomica}.
     */
    private Ambulancia validarAmbulancia(UUID ambulanciaId) {
        Ambulancia ambulancia = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new AmbulanciaNoDisponibleException(ambulanciaId));
        if (ambulancia.getEstado() != EstadoAmbulancia.DISPONIBLE || !ambulancia.isConectada()) {
            throw new AmbulanciaNoDisponibleException(ambulanciaId);
        }
        return ambulancia;
    }
}
