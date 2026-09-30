package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudLlegadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DeclararLlegadaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Declares the winning unit's arrival at the scene.
 *
 * <p><b>Milestone, not a state.</b> The request stays ASIGNADA; the arrival is
 * recorded in {@code llegadaEn}, so no parallel lifecycle is introduced (the
 * existing {@code EstadoSolicitud} enum is reused unchanged).
 *
 * <p><b>Idempotent.</b> The arrival is written with an atomic
 * {@code UPDATE ... WHERE llegadaEn IS NULL}: only the call that actually
 * records it emits the post-commit event, and a repeat (a retry or a double
 * tap) returns the current request without re-notifying the citizen.
 *
 * <p><b>Authorization.</b> Mirroring accept, the unit must be the one assigned
 * to the request AND must belong to the authenticated driver, so a driver
 * cannot declare an arrival on another unit's mission.
 */
@Service
public class DeclararLlegadaUseCaseImpl implements DeclararLlegadaUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public DeclararLlegadaUseCaseImpl(SolicitudRepository solicitudRepository,
                                      AmbulanciaRepository ambulanciaRepository,
                                      ApplicationEventPublisher eventPublisher) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia declararLlegada(UUID solicitudId, UUID ambulanciaId, UUID conductorId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        validarUnidadDelConductor(solicitud, ambulanciaId, conductorId);

        // Idempotent: an already-recorded arrival is returned as-is, without a
        // second event, so a retry or a double tap cannot re-notify the citizen.
        if (solicitud.getLlegadaEn() != null) {
            return solicitud;
        }

        if (solicitud.getEstado() != EstadoSolicitud.ASIGNADA) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        Instant ahora = Instant.now();
        int filas = solicitudRepository.transicionAtomicaLlegada(solicitudId, ahora);
        if (filas == 0) {
            // Lost the race against a parallel declaration: the request is
            // already arrived, so treat it as the same idempotent no-op.
            SolicitudAmbulancia actual = solicitudRepository.buscarPorId(solicitudId)
                    .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));
            if (actual.getLlegadaEn() != null) {
                return actual;
            }
            throw new SolicitudNoAsignableException(solicitudId, actual.getEstado());
        }

        SolicitudAmbulancia llegada = solicitud.llegar(ahora);

        eventPublisher.publishEvent(new SolicitudLlegadaEvent(
                solicitudId, llegada.getEmergenciaId(), llegada.getZonaId(),
                ambulanciaId, llegada.getSolicitanteId()));

        return llegada;
    }

    /**
     * The arriving unit must be the one assigned to the request and must belong
     * to the authenticated driver. A unit without a driver matches nobody
     * ({@code Objects.equals(null, x)} is false), so it can never declare.
     */
    private void validarUnidadDelConductor(SolicitudAmbulancia solicitud, UUID ambulanciaId, UUID conductorId) {
        if (!Objects.equals(solicitud.getAmbulanciaAsignadaId(), ambulanciaId)) {
            throw new SolicitudNoAsignableException(solicitud.getId(), solicitud.getEstado());
        }
        Ambulancia ambulancia = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new AmbulanciaNoDisponibleException(ambulanciaId));
        if (!Objects.equals(ambulancia.getConductorId(), conductorId)) {
            throw new SolicitudNoAsignableException(solicitud.getId(), solicitud.getEstado());
        }
    }
}
