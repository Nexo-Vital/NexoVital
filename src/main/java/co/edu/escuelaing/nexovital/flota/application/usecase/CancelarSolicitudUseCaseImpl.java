package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudCanceladaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.CancelarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * The requester withdraws the request while it is still PENDIENTE.
 *
 * <p><b>Only before someone accepted.</b> Once a unit won the accept the
 * ambulance is on its way; calling it back is a different operation the design
 * deliberately excludes, so a request that already moved answers 409
 * ({@link SolicitudNoAsignableException}). The state is checked twice: a fast
 * read for a clear response, and then the atomic CAS
 * ({@code WHERE estado = PENDIENTE}) so two concurrent callers (or a cancel that
 * races an accept) cannot both "cancel" the same request — the loser gets 0 rows
 * and the same 409, never a 500.
 *
 * <p><b>Only the requester.</b> The caller's user id (resolved by the controller
 * from the JWT principal) is compared with the request's own
 * {@code solicitanteId}, exactly as confirmation binds it. A mismatch is an
 * authorization refusal and answers 403 ({@link SolicitudAjenaException}), not
 * the 409 the design reserves for "already moved".
 */
@Service
public class CancelarSolicitudUseCaseImpl implements CancelarSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final ApplicationEventPublisher eventPublisher;

    public CancelarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                        ApplicationEventPublisher eventPublisher) {
        this.solicitudRepository = solicitudRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia cancelar(UUID solicitudId, UUID solicitanteId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        // Authorization first: only the requester may withdraw. A legacy row
        // without a requester matches nobody and can never be cancelled.
        if (!Objects.equals(solicitud.getSolicitanteId(), solicitanteId)) {
            throw new SolicitudAjenaException(solicitudId, solicitanteId);
        }

        if (solicitud.getEstado() != EstadoSolicitud.PENDIENTE) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        // Atomic CAS: only a still-PENDIENTE row moves to CANCELADA. A concurrent
        // accept or a second cancel wins first and this call gets 0 rows.
        int filas = solicitudRepository.transicionAtomicaEstado(
                solicitudId, EstadoSolicitud.PENDIENTE, EstadoSolicitud.CANCELADA);
        if (filas == 0) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        SolicitudAmbulancia cancelada = solicitud.cancelar();

        eventPublisher.publishEvent(new SolicitudCanceladaEvent(
                solicitudId, cancelada.getEmergenciaId(), cancelada.getZonaId(),
                cancelada.getAmbulanciasNotificadas(), cancelada.getSolicitanteId()));

        return cancelada;
    }
}
