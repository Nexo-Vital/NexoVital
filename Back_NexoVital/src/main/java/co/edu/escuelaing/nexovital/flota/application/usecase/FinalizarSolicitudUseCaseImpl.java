package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudFinalizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.LlegadaNoDeclaradaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.FinalizarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Finishes the attended service: closes the request and releases the unit in
 * the SAME atomic operation (EP-04.F2.US6/US11, "misma operación del cierre").
 *
 * <p>Closing and releasing are not two client steps: the request leaves the
 * active set (ASIGNADA/CONFIRMADA → TOMADA) and the unit returns to
 * {@code DISPONIBLE} inside one transaction. Both changes are conditional
 * updates, so a double "finalizar" (or a race) resolves to a single winner and
 * the loser receives the contract's 409, never a 500.
 *
 * <p><b>Authorization.</b> The unit must be the one assigned to the request and
 * must belong to the authenticated driver, mirroring accept/reject/arrival.
 */
@Service
public class FinalizarSolicitudUseCaseImpl implements FinalizarSolicitudUseCase {

    private static final List<EstadoSolicitud> ESTADOS_EN_SERVICIO =
            List.of(EstadoSolicitud.ASIGNADA, EstadoSolicitud.CONFIRMADA);

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public FinalizarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                         AmbulanciaRepository ambulanciaRepository,
                                         ApplicationEventPublisher eventPublisher) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia finalizar(UUID solicitudId, UUID ambulanciaId, UUID conductorId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        validarUnidadAsignadaDelConductor(solicitud, ambulanciaId, conductorId);

        // A service cannot be finished without its arrival time (EP-04.F2.US8 /
        // US10, M-04). The arrival is only ever written once (null -> instant),
        // so this pre-check cannot be invalidated by a race.
        if (solicitud.getLlegadaEn() == null) {
            throw new LlegadaNoDeclaradaException(solicitudId);
        }

        int cerrada = solicitudRepository.transicionAtomicaFinalizar(
                solicitudId, ESTADOS_EN_SERVICIO, EstadoSolicitud.TOMADA);
        if (cerrada == 0) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        // Release in the same transaction: if the unit is no longer EN_MISION the
        // 0 rows roll the whole operation back, so the request is not closed
        // without its unit.
        int liberada = ambulanciaRepository.transicionAtomicaEstado(
                ambulanciaId, EstadoAmbulancia.EN_MISION, EstadoAmbulancia.DISPONIBLE);
        if (liberada == 0) {
            throw new AmbulanciaNoDisponibleException(ambulanciaId);
        }

        SolicitudAmbulancia finalizada = solicitud.finalizar();

        eventPublisher.publishEvent(new SolicitudFinalizadaEvent(
                solicitudId, finalizada.getEmergenciaId(), finalizada.getZonaId(),
                ambulanciaId, finalizada.getSolicitanteId()));
        eventPublisher.publishEvent(new FlotaActualizadaEvent(ambulanciaId, EstadoAmbulancia.DISPONIBLE));

        return finalizada;
    }

    /**
     * The finishing unit must be the one assigned to the request and must belong
     * to the authenticated driver. A unit without a driver matches nobody
     * ({@code Objects.equals(null, x)} is false), so it can never finish.
     */
    private void validarUnidadAsignadaDelConductor(SolicitudAmbulancia solicitud, UUID ambulanciaId,
                                                   UUID conductorId) {
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
