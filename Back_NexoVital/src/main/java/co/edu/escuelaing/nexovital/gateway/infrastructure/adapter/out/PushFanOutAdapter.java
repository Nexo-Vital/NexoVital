package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicLong;
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
 *       instrumenta el mensaje y lo publica en el exchange fanout. Todas las
 *       instancias —esta incluida— reciben su copia por su propia cola y la
 *       entregan en {@link PushBrokerListener}. Es lo que hace que un evento
 *       publicado en una instancia alcance a los clientes de otra.</li>
 *   <li><b>Sin broker</b> (desarrollo y tests): entrega directo a
 *       {@link SimpMessagingTemplate}, como antes. Una sola instancia no necesita
 *       coordinar nada y la suite no depende de que haya un broker corriendo.</li>
 * </ul>
 *
 * <p><b>Por qué en el camino con broker no se entrega también local:</b> sería
 * una entrega doble para los clientes de la instancia que originó el evento. Ella
 * también está suscrita a su propia cola, así que ya va a recibir su copia.
 *
 * <p><b>Instrumentación (T27).</b> {@code emitidoEn}, {@code consecutivo} e
 * {@code instancia} se asignan <b>una sola vez, al publicar</b>. Si se asignaran
 * al entregar, cada nodo numeraría el mismo evento con su propia secuencia y el
 * receptor vería dos numeraciones distintas. El consecutivo es por instancia y
 * destino: uno global se intercalaría entre nodos y daría huecos que no son
 * pérdidas.
 */
@Component
public class PushFanOutAdapter {

    /** Momento de publicación, en epoch de milisegundos. */
    static final String CABECERA_EMITIDO_EN = "emitidoEn";
    /** Número creciente por instancia y destino. */
    static final String CABECERA_CONSECUTIVO = "consecutivo";
    /** Instancia que publicó el evento. */
    static final String CABECERA_INSTANCIA = "instancia";

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectProvider<RabbitTemplate> rabbitTemplate;
    private final boolean brokerHabilitado;
    private final String exchangePush;
    private final String instancia;
    private final ConcurrentMap<String, AtomicLong> consecutivos = new ConcurrentHashMap<>();

    /** Modo local, para composición manual en pruebas. */
    public PushFanOutAdapter(SimpMessagingTemplate messagingTemplate, String instancia) {
        this(messagingTemplate, null, false, "nexovital.push", instancia);
    }

    @Autowired
    public PushFanOutAdapter(
            SimpMessagingTemplate messagingTemplate,
            ObjectProvider<RabbitTemplate> rabbitTemplate,
            @Value("${nexovital.eventos.broker.enabled:false}") boolean brokerHabilitado,
            @Value("${nexovital.push.exchange:nexovital.push}") String exchangePush,
            @Value("${nexovital.instancia-id:${NEXOVITAL_INSTANCIA_ID:local}}") String instancia) {
        this.messagingTemplate = messagingTemplate;
        this.rabbitTemplate = rabbitTemplate;
        this.brokerHabilitado = brokerHabilitado;
        this.exchangePush = exchangePush;
        this.instancia = instancia;
    }

    /** El módulo dueño publicó un push: se instrumenta y va al broker o directo. */
    @EventListener
    public void alSolicitarPush(PushMessage mensaje) {
        PushMessage instrumentado = instrumentar(mensaje);

        RabbitTemplate template = brokerHabilitado ? rabbitTemplate.getIfAvailable() : null;
        if (template != null) {
            // Fanout: el routing key no se usa, todas las colas atadas reciben.
            template.convertAndSend(exchangePush, "", instrumentado);
            return;
        }
        entregarLocal(instrumentado);
    }

    /**
     * Entrega a las sesiones de este proceso. La usa también
     * {@link PushBrokerListener} cuando el mensaje llega desde el broker.
     *
     * <p>Cuando el mensaje lleva un {@code usuario} (destino por usuario) se usa
     * {@code convertAndSendToUser}: es la única forma de que un broadcast alcance
     * a CADA suscriptor, porque un {@code /queue} compartido con N sesiones
     * reparte en round-robin y solo llegaría a una. Sin usuario ({@code null}) el
     * destino es un tópico o una cola compartida y se usa {@code convertAndSend}.
     */
    public void entregarLocal(PushMessage mensaje) {
        Map<String, Object> cabeceras = cabecerasDe(mensaje);
        if (mensaje.usuario() != null) {
            messagingTemplate.convertAndSendToUser(
                    mensaje.usuario(), mensaje.destino(), mensaje.payload(), cabeceras);
            return;
        }
        messagingTemplate.convertAndSend(mensaje.destino(), mensaje.payload(), cabeceras);
    }

    private PushMessage instrumentar(PushMessage mensaje) {
        if (mensaje.instrumentado()) {
            return mensaje;
        }
        long consecutivo = consecutivos
                .computeIfAbsent(mensaje.destino(), clave -> new AtomicLong())
                .incrementAndGet();
        return new PushMessage(
                mensaje.destino(),
                mensaje.payload(),
                mensaje.usuario(),
                Long.toString(System.currentTimeMillis()),
                Long.toString(consecutivo),
                instancia);
    }

    private Map<String, Object> cabecerasDe(PushMessage mensaje) {
        Map<String, Object> cabeceras = new HashMap<>(4);
        if (mensaje.emitidoEn() != null) {
            cabeceras.put(CABECERA_EMITIDO_EN, mensaje.emitidoEn());
            cabeceras.put(CABECERA_CONSECUTIVO, mensaje.consecutivo());
            cabeceras.put(CABECERA_INSTANCIA, mensaje.instancia());
        }
        return cabeceras;
    }
}
