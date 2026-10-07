package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudRechazadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.RechazarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A unit declines the request.
 *
 * <p><b>Adaptation (AC4).</b> The source marked the whole request RECHAZADA on
 * the first decline, which would close the broadcast as soon as one driver said
 * no and leave the other notified units unable to accept. A decline is a
 * PER-UNIT decision: the request stays PENDIENTE so the rest can still accept
 * (AC4), matching the front protocol where {@code request.rejected} with
 * {@code reason: "rejected"} means "the addressed unit declined". Only the
 * declining driver is notified, after commit.
 *
 * <p><b>The decline is recorded (EP-04.F2.US5).</b> The unit is stored among
 * the ones that declined this request, so the server knows who said no: that
 * unit keeps seeing the request while it is open, but its accept is refused. A
 * decline is final for that unit and that request.
 *
 * <p>It never changes the request row (state, deadline or version): the decline
 * is written apart, so it cannot close or disturb the race that the accept CAS
 * resolves, and two units declining at the same instant never collide.
 *
 * <p><b>Idempotent.</b> Declining again answers the same and writes nothing;
 * the driver is told only the first time.
 *
 * <p><b>Authorization.</b> Mirroring accept, the notified unit must also belong
 * to the authenticated driver: without this check a driver could decline on
 * behalf of another unit that the request notified.
 */
@Service
public class RechazarSolicitudUseCaseImpl implements RechazarSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;

    public RechazarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                        AmbulanciaRepository ambulanciaRepository,
                                        ApplicationEventPublisher eventPublisher,
                                        Clock clock) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia rechazar(UUID solicitudId, UUID ambulanciaId, UUID conductorId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        if (solicitud.getEstado() != EstadoSolicitud.PENDIENTE) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }
        if (!solicitud.fueNotificada(ambulanciaId)) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }
        // The unit must be the one driven by the authenticated user: the client
        // sends `ambulanciaId`, so it cannot be trusted to pick someone else's
        // unit. A unit without a driver matches nobody (Objects.equals(null, x)
        // is false), so it can never decline.
        Ambulancia ambulancia = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new SolicitudNoAsignableException(solicitudId, solicitud.getEstado()));
        if (!Objects.equals(ambulancia.getConductorId(), conductorId)) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        boolean registrado = solicitudRepository.registrarRechazo(solicitudId, ambulanciaId, Instant.now(clock));
        if (registrado) {
            eventPublisher.publishEvent(new SolicitudRechazadaEvent(
                    solicitudId, solicitud.getEmergenciaId(), solicitud.getZonaId(), ambulanciaId));
        }
        return solicitud.conRechazoDe(ambulanciaId);
    }
}
