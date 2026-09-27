package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudRechazadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.RechazarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
 * <p>This is a read of the current state plus the event; it never changes the
 * request state, so it cannot close the race that the accept CAS resolves.
 */
@Service
public class RechazarSolicitudUseCaseImpl implements RechazarSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final ApplicationEventPublisher eventPublisher;

    public RechazarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                        ApplicationEventPublisher eventPublisher) {
        this.solicitudRepository = solicitudRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia rechazar(UUID solicitudId, UUID ambulanciaId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        if (solicitud.getEstado() != EstadoSolicitud.PENDIENTE) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }
        if (!solicitud.fueNotificada(ambulanciaId)) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        eventPublisher.publishEvent(new SolicitudRechazadaEvent(
                solicitudId, solicitud.getEmergenciaId(), solicitud.getZonaId(), ambulanciaId));
        return solicitud;
    }
}
