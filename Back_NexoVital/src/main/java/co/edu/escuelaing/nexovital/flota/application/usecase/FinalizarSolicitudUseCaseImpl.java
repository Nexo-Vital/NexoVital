package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudFinalizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.ConfirmacionPendienteException;
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

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Finishes the attended service: closes the request and releases the unit in
 * the SAME atomic operation (EP-04.F2.US6/US11, "misma operación del cierre").
 *
 * <p>Closing and releasing are not two client steps: the request leaves the
 * active set (CONFIRMADA → TOMADA) and the unit returns to
 * {@code DISPONIBLE} inside one transaction. Both changes are conditional
 * updates, so a double "finalizar" (or a race) resolves to a single winner and
 * the loser receives the contract's 409, never a 500.
 *
 * <p><b>Authorization.</b> The unit must be the one assigned to the request and
 * must belong to the authenticated driver, mirroring accept/reject/arrival.
 */
@Service
public class FinalizarSolicitudUseCaseImpl implements FinalizarSolicitudUseCase {

    // Only a confirmed service can be finished (citizen or automatic confirmation).
    private static final List<EstadoSolicitud> ESTADOS_EN_SERVICIO =
            List.of(EstadoSolicitud.CONFIRMADA);

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final RegistroAuditoriaPort registroAuditoriaPort;

    public FinalizarSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                         AmbulanciaRepository ambulanciaRepository,
                                         ApplicationEventPublisher eventPublisher,
                                         RegistroAuditoriaPort registroAuditoriaPort) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.registroAuditoriaPort = registroAuditoriaPort;
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
        if (solicitud.getEstado() == EstadoSolicitud.ASIGNADA) {
            throw new ConfirmacionPendienteException(solicitudId);
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

        // Bitácora del cierre en la MISMA transacción (Sprint 2, T14).
        registroAuditoriaPort.registrar(EventoAuditoria.nuevo(
                AccionCritica.SERVICIO_FINALIZADO,
                tipoRecurso(finalizada),
                idRecurso(finalizada),
                conductorId,
                "solicitud=" + solicitudId + " ambulancia=" + ambulanciaId,
                Instant.now()));

        eventPublisher.publishEvent(new SolicitudFinalizadaEvent(
                solicitudId, finalizada.getEmergenciaId(), finalizada.getZonaId(),
                ambulanciaId, finalizada.getSolicitanteId()));
        eventPublisher.publishEvent(new FlotaActualizadaEvent(ambulanciaId, EstadoAmbulancia.DISPONIBLE));

        return finalizada;
    }

    /**
     * Primero la propiedad, después el estado (Sprint 2, S-4 / T10). La unidad
     * debe ser del conductor autenticado: si no, es un 403
     * ({@link AmbulanciaAjenaException}), porque falta el permiso y reintentar
     * no lo arregla. Una unidad sin conductor no es de nadie
     * ({@code Objects.equals(null, x)} es false). Recién con la propiedad
     * resuelta se exige que sea la unidad asignada a la solicitud (409 si no).
     */
    private void validarUnidadAsignadaDelConductor(SolicitudAmbulancia solicitud, UUID ambulanciaId,
                                                   UUID conductorId) {
        Ambulancia ambulancia = ambulanciaRepository.buscarPorId(ambulanciaId)
                .orElseThrow(() -> new AmbulanciaNoDisponibleException(ambulanciaId));
        if (!Objects.equals(ambulancia.getConductorId(), conductorId)) {
            throw new AmbulanciaAjenaException(ambulanciaId);
        }
        if (!Objects.equals(solicitud.getAmbulanciaAsignadaId(), ambulanciaId)) {
            throw new SolicitudNoAsignableException(solicitud.getId(), solicitud.getEstado());
        }
    }

    /** La traza vive en la emergencia; sin emergencia, en la propia solicitud. */
    private static String tipoRecurso(SolicitudAmbulancia solicitud) {
        return solicitud.getEmergenciaId() != null
                ? EventoAuditoria.TIPO_EMERGENCIA
                : EventoAuditoria.TIPO_SOLICITUD;
    }

    private static UUID idRecurso(SolicitudAmbulancia solicitud) {
        return solicitud.getEmergenciaId() != null ? solicitud.getEmergenciaId() : solicitud.getId();
    }
}
