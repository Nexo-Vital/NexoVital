package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.util.UUID;

/**
 * Delivers the shortage alerts of {@code recursos} to the {@link PushPort}
 * ALWAYS after commit. The {@code AFTER_COMMIT} phase guarantees the consumer
 * never sees an alert the database did not confirm: it is the golden rule of the
 * contract ("publish POST-COMMIT"). Mirror of {@code InventarioPushListener} and
 * {@code FlotaPushListener}.
 *
 * <p><b>Destination.</b> A dedicated channel, {@code /topic/alerts}. The system
 * design already declares it as a gateway destination
 * ({@code system-design/10-organizacion-modular-hexagonal.md:147-148},
 * {@code system-design/09-organizacion-microservicios-corregida.md:272}) and
 * pairs it with the {@code alert.emitted} domain event consumed by {@code mapa}
 * (doc 08, correction of 8 sep). The STOMP {@code contract/README.md} does NOT
 * list it yet, so this is a declared delta of the contract README, not a new
 * invented name.
 *
 * <p><b>Why not reuse {@code /topic/suministros}.</b> That channel means
 * "inventory and traffic light updated", and the front only re-reads the map for
 * a frame that passes {@code fromWireInventario}; a rejected dispatch changes no
 * stock (the CAS rolled back), so publishing an item there would assert false
 * inventory semantics. The alert gets its own channel.
 *
 * <p>The payload is the shortage-alert projection. The map read-model exposes
 * the alert only through {@code GET /api/v1/mapa}, so the consumer uses the frame
 * as the signal to re-read that projection; the frame also carries the resource,
 * the demand and the current missing quantity for a subscriber that wants them
 * without a second read.
 */
@Component
public class AlertaEscasezPushListener {

    /** Destination declared by the system design for realtime alerts. */
    public static final String DESTINO_ALERTAS = "/topic/alerts";

    private final PushPort pushPort;

    public AlertaEscasezPushListener(PushPort pushPort) {
        this.pushPort = pushPort;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRegistrarAlerta(AlertaEscasezRegistradaEvento evento) {
        pushPort.publicar(DESTINO_ALERTAS, AlertaEscasezPushPayload.desde(evento));
    }

    /**
     * Public projection of a shortage alert. It is the same information the map
     * publishes per center ({@code AlertaEscasezDto}: resource, demand, missing
     * quantity), plus the center id needed to locate it and the stock seen at
     * rejection time. {@code faltante} is computed against that stock
     * ({@code cantidadSolicitada - disponibleActual}), never a stored deficit.
     */
    public record AlertaEscasezPushPayload(UUID centroAcopioId,
                                           UUID itemId,
                                           String nombre,
                                           int cantidadSolicitada,
                                           int disponibleActual,
                                           int faltante,
                                           Instant creadaEn) {

        static AlertaEscasezPushPayload desde(AlertaEscasezRegistradaEvento evento) {
            AlertaEscasez alerta = evento.alerta();
            return new AlertaEscasezPushPayload(
                    alerta.getCentroAcopioId(),
                    alerta.getItemId(),
                    alerta.getNombre(),
                    alerta.getCantidadSolicitada(),
                    evento.disponibleActual(),
                    alerta.faltante(evento.disponibleActual()),
                    alerta.getCreadaEn());
        }
    }
}
