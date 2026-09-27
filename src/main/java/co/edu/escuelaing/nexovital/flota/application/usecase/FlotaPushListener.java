package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudAsignadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudConfirmadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudCreadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudRechazadaEvent;
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
 * <p><b>Debt (stage 3).</b> The front must subscribe to
 * {@code /user/queue/solicitudes}, not {@code /queue/solicitudes} (D-F1).
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
     * unit (AC1). The payload is the same for each copy.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alCrearSolicitud(SolicitudCreadaEvent evento) {
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), evento.emergenciaId(), evento.zonaId(),
                "PENDIENTE", evento.ambulanciasNotificadas(), null);
        for (UUID ambulanciaId : evento.ambulanciasNotificadas()) {
            publicarAlConductor(ambulanciaId, payload);
        }
    }

    /** The winning unit's driver is told its bid was accepted. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alAsignarSolicitud(SolicitudAsignadaEvent evento) {
        publicarAlConductor(evento.ambulanciaId(), new SolicitudPushPayload(
                evento.solicitudId(), evento.emergenciaId(), evento.zonaId(),
                "ASIGNADA", List.of(), evento.ambulanciaId()));
    }

    /** Only the declining driver is told; the request stays open for the rest. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRechazarSolicitud(SolicitudRechazadaEvent evento) {
        publicarAlConductor(evento.ambulanciaId(), new SolicitudPushPayload(
                evento.solicitudId(), evento.emergenciaId(), evento.zonaId(),
                "RECHAZADA", List.of(), null));
    }

    /** The help center confirmed the assignment: the assigned driver is told. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alConfirmarSolicitud(SolicitudConfirmadaEvent evento) {
        publicarAlConductor(evento.ambulanciaId(), new SolicitudPushPayload(
                evento.solicitudId(), evento.emergenciaId(), evento.zonaId(),
                "CONFIRMADA", List.of(), evento.ambulanciaId()));
    }

    /** State/position feed: a topic so every subscribed client sees the same state. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alActualizarFlota(FlotaActualizadaEvent evento) {
        pushPort.publicar(DESTINO_FLOTA,
                new FlotaPushPayload(evento.ambulanciaId(), evento.estado().name()));
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

    /** Public projection of a request for the driver inbox. */
    public record SolicitudPushPayload(UUID solicitudId, UUID emergenciaId, String zonaId,
                                       String estado, List<UUID> ambulanciasNotificadas,
                                       UUID ambulanciaAsignadaId) {
    }

    /** Public projection of a fleet state change. */
    public record FlotaPushPayload(UUID ambulanciaId, String estado) {
    }
}
