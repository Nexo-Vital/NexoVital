package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Consumidor del canal interno de push y punto de decisión del fan-out
 * (ADR-0009).
 *
 * <p>Tiene dos caminos y elige uno por configuración:
 *
 * <ul>
 *   <li><b>Con broker</b> ({@code nexovital.eventos.broker.enabled=true}):
 *       publica en el exchange fanout y termina. Todas las instancias —esta
 *       incluida— reciben su copia por su propia cola y la entregan en
 *       {@link PushBrokerListener}. Es lo que hace que un evento publicado en una
 *       instancia alcance a los clientes de otra.</li>
 *   <li><b>Sin broker</b> (desarrollo y tests): entrega directo a
 *       {@link SimpMessagingTemplate}, como antes. Una sola instancia no necesita
 *       coordinar nada y la suite no depende de que haya un broker corriendo.</li>
 * </ul>
 *
 * <p><b>Por qué en el camino con broker no se entrega también local:</b> sería
 * una entrega doble para los clientes de la instancia que originó el evento. Ella
 * también está suscrita a su propia cola, así que ya va a recibir su copia.
 */
@Component
public class PushFanOutAdapter {

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectProvider<RabbitTemplate> rabbitTemplate;
    private final boolean brokerHabilitado;
    private final String exchangePush;

    /**
     * Camino sin broker, para composición manual (pruebas unitarias). Spring usa
     * el constructor anotado; este deja el adaptador en modo local, que es
     * exactamente lo que probaba el test antes de existir el broker.
     */
    public PushFanOutAdapter(SimpMessagingTemplate messagingTemplate) {
        this(messagingTemplate, null, false, "nexovital.push");
    }

    @Autowired
    public PushFanOutAdapter(SimpMessagingTemplate messagingTemplate,
                             ObjectProvider<RabbitTemplate> rabbitTemplate,
                             @Value("${nexovital.eventos.broker.enabled:false}") boolean brokerHabilitado,
                             @Value("${nexovital.push.exchange:nexovital.push}") String exchangePush) {
        this.messagingTemplate = messagingTemplate;
        this.rabbitTemplate = rabbitTemplate;
        this.brokerHabilitado = brokerHabilitado;
        this.exchangePush = exchangePush;
    }

    /** El módulo dueño publicó un push: va al broker si hay, o directo si no. */
    @EventListener
    public void alSolicitarPush(PushMessage mensaje) {
        RabbitTemplate template = brokerHabilitado ? rabbitTemplate.getIfAvailable() : null;
        if (template != null) {
            // Fanout: el routing key no se usa, todas las colas atadas reciben.
            template.convertAndSend(exchangePush, "", mensaje);
            return;
        }
        entregarLocal(mensaje);
    }

    /**
     * Entrega a las sesiones de este proceso.
     *
     * <p>Cuando el mensaje lleva un {@code usuario} (destino por usuario) se usa
     * {@code convertAndSendToUser}: es la única forma de que un broadcast alcance
     * a CADA suscriptor, porque un {@code /queue} compartido con N sesiones
     * reparte en round-robin y solo llegaría a una. Sin usuario ({@code null}) el
     * destino es un tópico o una cola compartida y se usa {@code convertAndSend}.
     */
    private void entregarLocal(PushMessage mensaje) {
        if (mensaje.usuario() != null) {
            messagingTemplate.convertAndSendToUser(mensaje.usuario(), mensaje.destino(), mensaje.payload());
            return;
        }
        messagingTemplate.convertAndSend(mensaje.destino(), mensaje.payload());
    }
}
