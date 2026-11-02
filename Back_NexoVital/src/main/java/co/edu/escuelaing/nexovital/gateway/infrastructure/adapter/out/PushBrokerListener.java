package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Recibe los eventos que llegaron por el broker y los empuja a las sesiones
 * STOMP <b>de esta instancia</b> (ADR-0009).
 *
 * <p>Este es el otro extremo del fan-out: cada instancia tiene su cola, así que
 * todas reciben el mismo evento, y cada una lo entrega solo a los clientes que
 * tiene conectados. Un evento publicado en la instancia B termina en los clientes
 * de la A porque la A también recibió su copia.
 *
 * <p>La entrega por usuario sigue funcionando sin cambios: el evento llega a
 * todas las instancias, cada una intenta entregarlo y solo la que tiene esa
 * sesión lo logra.
 */
@Component
@ConditionalOnProperty(name = "nexovital.eventos.broker.enabled", havingValue = "true")
public class PushBrokerListener {

    private final SimpMessagingTemplate messagingTemplate;

    public PushBrokerListener(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Consume de la cola propia (la que declara {@link RabbitPropagacionConfig}).
     * La referencia por nombre de bean evita duplicar el formato del nombre de la
     * cola en un segundo lugar.
     */
    @RabbitListener(queues = "#{@colaPush.name}")
    public void alRecibirPush(PushMessage mensaje) {
        if (mensaje.usuario() != null) {
            messagingTemplate.convertAndSendToUser(
                    mensaje.usuario(), mensaje.destino(), mensaje.payload());
            return;
        }
        messagingTemplate.convertAndSend(mensaje.destino(), mensaje.payload());
    }
}
