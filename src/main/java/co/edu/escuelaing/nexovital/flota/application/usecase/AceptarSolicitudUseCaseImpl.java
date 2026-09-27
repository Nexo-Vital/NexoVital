package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudAsignadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    public ResultadoAceptarSolicitud aceptar(UUID solicitudId, UUID ambulanciaId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        if (solicitud.getEstado() != EstadoSolicitud.PENDIENTE) {
            throw new SolicitudNoAsignableException(solicitudId, solicitud.getEstado());
        }

        validarAmbulanciaDisponible(ambulanciaId);

        int filas = solicitudRepository.transicionAtomicaAsignar(
                solicitudId, ambulanciaId, EstadoSolicitud.PENDIENTE, EstadoSolicitud.ASIGNADA);

        if (filas == 0) {
            return ResultadoAceptarSolicitud.perdio(solicitud);
        }

        SolicitudAmbulancia asignada = solicitud.aceptar(ambulanciaId);

        ambulanciaRepository.actualizarEstado(ambulanciaId, EstadoAmbulancia.EN_MISION);

        eventPublisher.publishEvent(new SolicitudAsignadaEvent(
                solicitudId, asignada.getEmergenciaId(), asignada.getZonaId(), ambulanciaId,
                asignada.getSolicitanteId()));
        eventPublisher.publishEvent(new FlotaActualizadaEvent(ambulanciaId, EstadoAmbulancia.EN_MISION));

        return ResultadoAceptarSolicitud.gano(asignada);
    }

    private void validarAmbulanciaDisponible(UUID ambulanciaId) {
        Ambulancia ambulancia = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new AmbulanciaNoDisponibleException(ambulanciaId));
        if (ambulancia.getEstado() != EstadoAmbulancia.DISPONIBLE) {
            throw new AmbulanciaNoDisponibleException(ambulanciaId);
        }
    }
}
