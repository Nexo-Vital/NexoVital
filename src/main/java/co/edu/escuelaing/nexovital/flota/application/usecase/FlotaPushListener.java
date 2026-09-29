package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.PosicionActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudAsignadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudCanceladaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudConfirmadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudCreadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudExpiradaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudFinalizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudLlegadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudRechazadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Delivers the fleet events to the {@link PushPort} ALWAYS after commit. The
 * {@code AFTER_COMMIT} phase guarantees the consumer never sees an event the
 * database did not confirm: it is the golden rule of the contract ("publish
 * POST-COMMIT").
 *
 * <p><b>D-F1 — per-user broadcast.</b> The request is broadcast with
 * {@code publicarAUsuario(...)}, one delivery per notified unit. A plain
 * {@code /queue/solicitudes} destination with N subscribers is round-robin in
 * Spring's simple broker and would reach only ONE unit, breaking the broadcast.
 * The user is the driver user id ({@code Ambulancia.conductorId}); the STOMP
 * Principal is the {@code Usuario} and {@code Usuario.getName()} resolves to
 * that same id, so the subscribed session {@code /user/queue/solicitudes}
 * receives its own copy. {@code /topic/flota} stays a topic.
 *
 * <p><b>Requester lifecycle.</b> The user who raised the request
 * ({@code solicitanteId}) also receives the request-level states — creation
 * (PENDIENTE), assignment (ASIGNADA) and confirmation (CONFIRMADA) — on their own
 * {@code /queue/solicitudes} user destination, so the citizen's screen leaves
 * "Pidiendo ambulancia…". The per-unit decline (RECHAZADA) is NEVER sent to the
 * requester: it is one addressed unit's ack, and the front would map it to
 * {@code request.rejected}, making the citizen believe their still-open request
 * failed.
 *
 * <p><b>Pickup location.</b> The creation frame carries the request's
 * {@code ubicacion}; the driver card and the request detail read it to show
 * where to go. Later lifecycle frames keep it null: the front already holds the
 * pickup point from the creation frame.
 */
@Component
public class FlotaPushListener {

    /** Destination declared in the contract for the driver inbox. */
    public static final String DESTINO_SOLICITUDES = "/queue/solicitudes";
    /** Destination declared in the contract for the live fleet feed. */
    public static final String DESTINO_FLOTA = "/topic/flota";

    private final PushPort pushPort;
    private final AmbulanciaRepository ambulanciaRepository;

    public FlotaPushListener(PushPort pushPort, AmbulanciaRepository ambulanciaRepository) {
        this.pushPort = pushPort;
        this.ambulanciaRepository = ambulanciaRepository;
    }

    /**
     * Fans the new request out to EVERY notified unit, one user destination per
     * unit (AC1). The payload carries the pickup {@code ubicacion} so every
     * driver knows where to go; it is the same for each copy.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alCrearSolicitud(SolicitudCreadaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), new Ubicacion(evento.lat(), evento.lng()),
                evento.emergenciaId(), evento.zonaId(),
                "PENDIENTE", evento.ambulanciasNotificadas(), null, false);
        for (UUID ambulanciaId : evento.ambulanciasNotificadas()) {
            publicarAlConductor(ambulanciaId, payload);
        }
        publicarAlSolicitante(evento.solicitanteId(), payload);
    }

    /** The winning unit's driver is told its bid was accepted; so is the requester. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alAsignarSolicitud(SolicitudAsignadaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "ASIGNADA", List.of(), evento.ambulanciaId(), false);
        publicarAlConductor(evento.ambulanciaId(), payload);
        publicarAlSolicitante(evento.solicitanteId(), payload);
    }

    /**
     * Only the declining driver is told; the request stays open for the rest.
     *
     * <p><b>Never delivered to the requester.</b> {@code RECHAZADA} here is a
     * PER-UNIT acknowledgement (one addressed unit declined), not a request-level
     * state: the request is still PENDIENTE and another unit may still accept it.
     * The front maps {@code RECHAZADA -> request.rejected}, so sending it to the
     * citizen would make them believe their request failed while it is still
     * open. The requester only receives states that hold for the whole request:
     * PENDIENTE (creation), ASIGNADA (assignment) and CONFIRMADA (confirmation).
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRechazarSolicitud(SolicitudRechazadaEvent evento) {
        publicarAlConductor(evento.ambulanciaId(), new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "RECHAZADA", List.of(), null, false));
    }

    /**
     * The winning unit arrived: the requester is told, so the citizen's screen
     * leaves the "on the way" phase. The request state stays ASIGNADA; the
     * arrival is flagged with {@code llegada=true} instead of a new state, so no
     * parallel lifecycle is introduced. Only the requester is notified: the
     * arriving driver already adopted the REST response.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alDeclararLlegada(SolicitudLlegadaEvent evento) {
        publicarAlSolicitante(evento.solicitanteId(), new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "ASIGNADA", List.of(), evento.ambulanciaId(), true));
    }

    /** The help center confirmed the assignment: the assigned driver and the requester are told. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alConfirmarSolicitud(SolicitudConfirmadaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "CONFIRMADA", List.of(), evento.ambulanciaId(), false);
        publicarAlConductor(evento.ambulanciaId(), payload);
        publicarAlSolicitante(evento.solicitanteId(), payload);
    }

    /**
     * The request expired with no winner: the requester is told so their screen
     * leaves the search instead of promising a window that never closed, and
     * each notified unit is told so the stale notification drops. TIMEOUT is the
     * whole-request state, so it is never a per-unit decline.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alExpirarSolicitud(SolicitudExpiradaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "TIMEOUT", evento.ambulanciasNotificadas(), null, false);
        for (UUID ambulanciaId : evento.ambulanciasNotificadas()) {
            publicarAlConductor(ambulanciaId, payload);
        }
        publicarAlSolicitante(evento.solicitanteId(), payload);
    }

    /**
     * The requester withdrew the open request: the requester is told so their
     * screen returns to the initial state, and each notified unit is told so the
     * stale notification drops. CANCELADA is a whole-request state (nobody
     * accepted), so it is fanned out like TIMEOUT and never a per-unit decline.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alCancelarSolicitud(SolicitudCanceladaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "CANCELADA", evento.ambulanciasNotificadas(), null, false);
        for (UUID ambulanciaId : evento.ambulanciasNotificadas()) {
            publicarAlConductor(ambulanciaId, payload);
        }
        publicarAlSolicitante(evento.solicitanteId(), payload);
    }

    /**
     * The service was attended and finished: the assigned driver and the
     * requester see the request closed (TOMADA). The unit's release travels
     * separately on {@code /topic/flota} via {@link FlotaActualizadaEvent}.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alFinalizarSolicitud(SolicitudFinalizadaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "TOMADA", List.of(), evento.ambulanciaId(), false);
        publicarAlConductor(evento.ambulanciaId(), payload);
        publicarAlSolicitante(evento.solicitanteId(), payload);
    }

    /** State/position feed: a topic so every subscribed client sees the same state. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alActualizarFlota(FlotaActualizadaEvent evento) {
        pushPort.publicar(DESTINO_FLOTA,
                new FlotaPushPayload(evento.ambulanciaId(), evento.estado().name()));
    }

    /**
     * Live position feed (EP-04.F1.US1, D-T3): a topic frame the front already
     * knows how to consume. It has no {@code type} discriminant (it is the
     * front's {@code LiveUnitPayload}) and the payload is UPSERTED by
     * {@code ambulanceId}. Published AFTER commit, as every fleet event is.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alActualizarPosicion(PosicionActualizadaEvent evento) {
        pushPort.publicar(DESTINO_FLOTA, PosicionPushPayload.desde(evento));
    }

    /**
     * Resolves the unit's driver and publishes to its OWN user destination. A
     * unit without a driver is skipped instead of failing the whole fan-out.
     */
    private void publicarAlConductor(UUID ambulanciaId, Object payload) {
        ambulanciaRepository.buscarPorId(ambulanciaId)
                .map(Ambulancia::getConductorId)
                .filter(Objects::nonNull)
                .ifPresent(conductorId -> pushPort.publicarAUsuario(
                        conductorId.toString(), DESTINO_SOLICITUDES, payload));
    }

    /**
     * Delivers the same payload to the requester's OWN user destination so the
     * citizen tracks their request lifecycle. A request without a requester
     * (legacy row) is skipped instead of failing the fan-out.
     */
    private void publicarAlSolicitante(UUID solicitanteId, Object payload) {
        if (solicitanteId != null) {
            pushPort.publicarAUsuario(solicitanteId.toString(), DESTINO_SOLICITUDES, payload);
        }
    }

    /** Pickup point of a request, as the driver card receives it. */
    public record Ubicacion(double lat, double lng) {
    }

    /** Public projection of a request for the driver inbox. */
    public record SolicitudPushPayload(UUID solicitudId, Ubicacion ubicacion, UUID emergenciaId,
                                       String zonaId, String estado, List<UUID> ambulanciasNotificadas,
                                       UUID ambulanciaAsignadaId, boolean llegada) {
    }

    /** Public projection of a fleet state change. */
    public record FlotaPushPayload(UUID ambulanciaId, String estado) {
    }

    /**
     * Live-position projection, shaped exactly like the front's
     * {@code LiveUnitPayload}: {@code ambulanceId}, {@code ubicacion},
     * {@code estado}, {@code heading}, {@code source}.
     *
     * <p><b>Enum bridge.</b> The front's {@code AmbulanceState} is English
     * ({@code AVAILABLE | ASSIGNED | EN_ROUTE | MAINTENANCE}) while the domain
     * enum is Spanish; the REST fleet read already bridges the same two at the
     * front boundary ({@code fleet-api.ts}), so the live frame must speak the
     * same English literal or the front's UPSERT would ignore it. {@code source}
     * is the front's lowercase {@code 'device' | 'simulated'}.
     */
    public record PosicionPushPayload(UUID ambulanceId, Ubicacion ubicacion, String estado,
                                      Integer heading, String source) {

        static PosicionPushPayload desde(PosicionActualizadaEvent evento) {
            return new PosicionPushPayload(
                    evento.ambulanciaId(),
                    new Ubicacion(evento.lat(), evento.lng()),
                    estadoWire(evento.estado()),
                    evento.heading(),
                    fuenteWire(evento.fuente()));
        }

        /** Domain state (Spanish) to the front's {@code AmbulanceState} (English). */
        private static String estadoWire(EstadoAmbulancia estado) {
            return switch (estado) {
                case DISPONIBLE -> "AVAILABLE";
                case EN_MISION -> "ASSIGNED";
                case EN_RUTA -> "EN_ROUTE";
                case MANTENIMIENTO -> "MAINTENANCE";
            };
        }

        /** Domain source to the front's lowercase {@code 'device' | 'simulated'}. */
        private static String fuenteWire(FuentePosicion fuente) {
            return switch (fuente) {
                case DEVICE -> "device";
                case SIMULADA -> "simulated";
            };
        }
    }
}
