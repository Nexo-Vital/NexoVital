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

import java.util.UUID;

/**
 * The help center confirms the assigned unit: ASIGNADA → CONFIRMADA with an
 * atomic CAS. Whoever tries to confirm a request that is no longer ASIGNADA
 * receives {@link SolicitudNoAsignableException} (409).
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
