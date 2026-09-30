package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Consumidor del canal interno de push que hace fan-out a las sesiones STOMP
 * (diseño US2 D5/D11). En el MVP consume el evento de aplicación en proceso que
 * publica el módulo dueño; el destino es la cola {@code ws.push} del exchange
 * fanout cuando exista broker.
 *
 * <p>Es un tubo tonto: solo ve {@code {destination, payload}} y lo entrega a
 * {@link SimpMessagingTemplate}. Nunca conoce eventos de dominio (Modelo Y del
 * ADR-0003). El destino del mapa es {@code /topic/map.events} y el de una
 * emergencia nueva, {@code /topic/emergencias}.
 */
@Component
public class PushFanOutAdapter {

    private final SimpMessagingTemplate messagingTemplate;

    public PushFanOutAdapter(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Publica el payload en su destino STOMP. Cuando el mensaje lleva un
     * {@code usuario} (destino por usuario, D-F1) se entrega con
     * {@code convertAndSendToUser}: es la única forma de que un broadcast
     * alcance a CADA suscriptor, porque un {@code /queue} compartido con N
     * sesiones reparte en round-robin y solo llegaría a una. Sin usuario
     * ({@code null}) el destino es un tópico o una cola compartida y se usa
     * {@code convertAndSend}. No hay suscriptores: es un no-op (el simple broker
     * no retiene mensajes).
     */
    @EventListener
    public void alSolicitarPush(PushMessage mensaje) {
        if (mensaje.usuario() != null) {
            messagingTemplate.convertAndSendToUser(mensaje.usuario(), mensaje.destino(), mensaje.payload());
            return;
        }
        messagingTemplate.convertAndSend(mensaje.destino(), mensaje.payload());
    }
}
