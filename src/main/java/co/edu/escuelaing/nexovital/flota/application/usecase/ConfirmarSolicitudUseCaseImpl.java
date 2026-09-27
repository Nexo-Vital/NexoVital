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
 * The help center confirms the assigned unit: ASIGNADA → CONFIRMADA with an
 * atomic CAS. Whoever tries to confirm a request that is no longer ASIGNADA
 * receives {@link SolicitudNoAsignableException} (409).
 *
 * <p><b>Authorization.</b> The authenticated caller must be the help center
 * the request was addressed to: the controller resolves the principal's user id
 * and this use case compares it with the request's own {@code centroAyudaId},
 * mirroring how accept binds the caller to the unit. Without the comparison any
 * authenticated role (a driver, a citizen) could confirm any assigned request.
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
    public SolicitudAmbulancia confirmar(UUID solicitudId, UUID centroAyudaId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));
        if (solicitud.getEstado() != EstadoSolicitud.ASIGNADA) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        // Only the addressed help center may confirm: the client sends no id, so
        // the principal resolved by the controller is compared with the request's
        // own centroAyudaId. A mismatch is a conflict, exactly like the other
        // actor-binding refusals (accept/reject/arrival).
        if (!Objects.equals(solicitud.getCentroAyudaId(), centroAyudaId)) {
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
