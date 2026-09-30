package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudConfirmadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * The requester confirms the assigned unit: ASIGNADA → CONFIRMADA with an
 * atomic CAS. Whoever tries to confirm a request that is no longer ASIGNADA
 * receives {@link SolicitudNoAsignableException} (409).
 *
 * <p><b>Authorization.</b> The authenticated caller must be the requester: the
 * controller resolves the principal's user id and this use case compares it with
 * the request's own {@code solicitanteId}. The front's confirmation actor is the
 * citizen — they tap "Sí, ya llegó" and the client calls the confirmar endpoint
 * — and {@code solicitanteId} is the user id that raised the request, so it is
 * the only identity on the request that can be bound to an authenticated
 * {@code Usuario}.
 *
 * <p><b>Why not the aid center.</b> The request also stores {@code centroAyudaId},
 * but that is an ORGANIZATION id (the map center the citizen chose), while
 * {@code Usuario} carries no organization link at all (only id, name, email,
 * password hash and role). Comparing the principal with {@code centroAyudaId}
 * therefore never matches a real user, and there is no user-to-organization
 * mapping to resolve it. Binding to the requester is the closest honest check the
 * current model supports; it still refuses every other caller.
 * A mismatch is reported as the same {@code 409 SOLICITUD_NO_ASIGNABLE} as the
 * other refusals, so the client cannot tell "not yours" from "already moved".
 */
@Service
public class ConfirmarSolicitudUseCaseImpl implements ConfirmarSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final ApplicationEventPublisher eventPublisher;

    public ConfirmarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                         ApplicationEventPublisher eventPublisher) {
        this.solicitudRepository = solicitudRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia confirmar(UUID solicitudId, UUID solicitanteId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));
        if (solicitud.getEstado() != EstadoSolicitud.ASIGNADA) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        // Only the requester may confirm: the client sends no id, so the
        // principal resolved by the controller is compared with the request's own
        // solicitanteId. A mismatch is a conflict, exactly like the other
        // actor-binding refusals (accept/reject/arrival).
        if (!Objects.equals(solicitud.getSolicitanteId(), solicitanteId)) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        int filas = solicitudRepository.transicionAtomicaEstado(
                solicitudId, EstadoSolicitud.ASIGNADA, EstadoSolicitud.CONFIRMADA);
        if (filas == 0) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        SolicitudAmbulancia confirmada = solicitud.confirmar();

        eventPublisher.publishEvent(new SolicitudConfirmadaEvent(
                solicitudId, confirmada.getEmergenciaId(), confirmada.getZonaId(),
                confirmada.getAmbulanciaAsignadaId(), confirmada.getSolicitanteId()));

        return confirmada;
    }
}
