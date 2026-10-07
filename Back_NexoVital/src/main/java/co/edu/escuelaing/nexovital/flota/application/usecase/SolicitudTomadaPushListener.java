package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudAsignadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Tells every OTHER notified unit that a request was taken, the moment one unit
 * wins it (EP-04.F2.US4).
 *
 * <p>{@link FlotaPushListener#alAsignarSolicitud} already tells the winner and
 * the requester. The units that did not win were told nothing, so their drivers
 * kept the request on screen until its window ran out, with a button that could
 * only fail. This listener completes the fan-out: each of those drivers receives
 * the same {@code ASIGNADA} frame on their OWN user destination, carrying the
 * winning unit, and the console drops the request at once.
 *
 * <p>It runs {@code AFTER_COMMIT}, like every push of the module: a losing
 * driver is never told about an assignment the database did not confirm. If the
 * accept is rolled back (the unit could not be occupied) the event is discarded
 * with the transaction and nobody is told anything.
 *
 * <p><b>Who is skipped.</b> The winning unit, which already has its own frame,
 * and any unit driven by the winner's own user: the frame is addressed to a
 * user, and that user must not read their own win as somebody else's. A unit
 * without a driver has no destination and is skipped too.
 */
@Component
public class SolicitudTomadaPushListener {

    private final PushPort pushPort;
    private final AmbulanciaRepository ambulanciaRepository;

    public SolicitudTomadaPushListener(PushPort pushPort, AmbulanciaRepository ambulanciaRepository) {
        this.pushPort = pushPort;
        this.ambulanciaRepository = ambulanciaRepository;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alAsignarSolicitud(SolicitudAsignadaEvent evento) {
        UUID conductorGanador = ambulanciaRepository.buscarPorId(evento.ambulanciaId())
                .map(Ambulancia::getConductorId)
                .orElse(null);

        // Same shape the winner receives: the request is ASIGNADA and
        // `ambulanciaAsignadaId` names who has it. The reader compares that id
        // with its own unit to tell a win from a loss.
        SolicitudPushPayload payload = new SolicitudPushPayload(
                evento.solicitudId(), null, evento.emergenciaId(), evento.zonaId(),
                "ASIGNADA", List.of(), evento.ambulanciaId(), false, null, null);

        // One frame per driver, even if a driver is linked to several units.
        Set<UUID> avisados = new HashSet<>();
        for (UUID ambulanciaId : evento.ambulanciasNotificadas()) {
            if (ambulanciaId.equals(evento.ambulanciaId())) {
                continue;
            }
            UUID conductorId = ambulanciaRepository.buscarPorId(ambulanciaId)
                    .map(Ambulancia::getConductorId)
                    .orElse(null);
            if (conductorId == null || Objects.equals(conductorId, conductorGanador)) {
                continue;
            }
            if (avisados.add(conductorId)) {
                pushPort.publicarAUsuario(
                        conductorId.toString(), FlotaPushListener.DESTINO_SOLICITUDES, payload);
            }
        }
    }
}
