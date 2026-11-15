package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.observabilidad.infrastructure.TraceId;
import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.springframework.amqp.AmqpException;
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
 * <p><b>Instrumentación (T27, T34).</b> {@code emitidoEn}, {@code consecutivo} e
 * {@code instancia} se asignan <b>una sola vez, al publicar</b>. Si se asignaran
 * al entregar, cada nodo numeraría el mismo evento con su propia secuencia y el
 * receptor vería dos numeraciones distintas. El consecutivo es por instancia y
 * destino: uno global se intercalaría entre nodos y daría huecos que no son
 * pérdidas. El {@code traceId} de la petición que originó el evento viaja igual:
 * dentro del mensaje por RabbitMQ y como cabecera STOMP, y la instancia que
 * entrega lo publica en su MDC mientras empuja, para que sus logs queden
 * correlacionados con los del origen.
 *
 * <p><b>Latencia de propagación (Sprint 2, T38, H6).</b> Al entregar a las
 * sesiones se mide {@code ahora - emitidoEn} en el timer
 * {@value #METRICA_PROPAGACION}, con la instancia que publicó como etiqueta
 * {@code origen}. Es el tiempo real que tarda un evento desde que se publica
 * hasta que la instancia que lo entrega lo pone en el canal de sus clientes,
 * incluido el salto por RabbitMQ cuando nace en el otro nodo. Antes el tablero
 * usaba la latencia HTTP de {@code POST /posicion}, que no mide la propagación.
 *
 * <p><b>Si RabbitMQ no responde (Sprint 2, T04).</b> Publicar en el exchange
 * puede fallar con {@link AmqpException} (broker caído, red cortada). En ese caso
 * el evento se entrega a las sesiones de ESTA instancia y queda un
 * {@code push_degradado} en el log: los clientes conectados aquí siguen viendo
 * el mapa en tiempo real y los de la otra instancia lo recuperan al releer el
 * estado. Sin esto, el evento se perdía en silencio para todos. No hay entrega
 * doble: si la publicación falló, el broker nunca devuelve la copia.
 *
 * <p><b>Seguimiento entre instancias (Sprint 2, T35).</b> Cada evento deja dos
 * líneas de log con su {@code traceId}: {@code push_publicado} en la instancia
 * que lo publica y {@code push_entregado} en CADA instancia que lo entrega a sus
 * sesiones (con la instancia de {@code origen} y la latencia). Filtrar los logs
 * de las dos instancias por el {@code traceId} reconstruye el recorrido completo:
 * petición → publicación → RabbitMQ → entrega en ambos nodos. La posición de la
 * flota ({@value #DESTINO_ALTA_FRECUENCIA}) llega una vez por segundo por
 * conductor, así que su seguimiento va en DEBUG para no inundar el log; el resto
 * (emergencias, solicitudes, inventario, mapa) va en INFO.
 */
@Component
public class PushFanOutAdapter {

    private static final Logger LOG = LoggerFactory.getLogger(PushFanOutAdapter.class);

    /** Momento de publicación, en epoch de milisegundos. */
    static final String CABECERA_EMITIDO_EN = "emitidoEn";
    /** Número creciente por instancia y destino. */
    static final String CABECERA_CONSECUTIVO = "consecutivo";
    /** Instancia que publicó el evento. */
    static final String CABECERA_INSTANCIA = "instancia";
    /** Identificador de correlación de la petición que originó el evento. */
    static final String CABECERA_TRACE_ID = "traceId";

    /** Destino de alta frecuencia: su seguimiento se registra en DEBUG (T35). */
    static final String DESTINO_ALTA_FRECUENCIA = "/topic/flota";

    /** Timer de la latencia de eventos en tiempo real (tablero técnico, H6). */
    static final String METRICA_PROPAGACION = "nexovital.push.propagacion";

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectProvider<RabbitTemplate> rabbitTemplate;
    private final boolean brokerHabilitado;
    private final String exchangePush;
    private final String instancia;
    private final MeterRegistry registro;
    private final ConcurrentMap<String, AtomicLong> consecutivos = new ConcurrentHashMap<>();

    /** Modo local, para composición manual en pruebas. */
    public PushFanOutAdapter(SimpMessagingTemplate messagingTemplate, String instancia) {
        this(messagingTemplate, null, false, "nexovital.push", instancia, null);
    }

    /** Composición manual en pruebas, sin medir la propagación. */
    public PushFanOutAdapter(
            SimpMessagingTemplate messagingTemplate,
            ObjectProvider<RabbitTemplate> rabbitTemplate,
            boolean brokerHabilitado,
            String exchangePush,
            String instancia) {
        this(messagingTemplate, rabbitTemplate, brokerHabilitado, exchangePush, instancia, null);
    }

    @Autowired
    public PushFanOutAdapter(
            SimpMessagingTemplate messagingTemplate,
            ObjectProvider<RabbitTemplate> rabbitTemplate,
            @Value("${nexovital.eventos.broker.enabled:false}") boolean brokerHabilitado,
            @Value("${nexovital.push.exchange:nexovital.push}") String exchangePush,
            @Value("${nexovital.instancia-id:${NEXOVITAL_INSTANCIA_ID:local}}") String instancia,
            MeterRegistry registro) {
        this.messagingTemplate = messagingTemplate;
        this.rabbitTemplate = rabbitTemplate;
        this.brokerHabilitado = brokerHabilitado;
        this.exchangePush = exchangePush;
        this.instancia = instancia;
        this.registro = registro;
    }

    /** El módulo dueño publicó un push: se instrumenta y va al broker o directo. */
    @EventListener
    public void alSolicitarPush(PushMessage mensaje) {
        PushMessage instrumentado = instrumentar(mensaje);

        RabbitTemplate template = brokerHabilitado ? rabbitTemplate.getIfAvailable() : null;
        if (template != null) {
            try {
                // Fanout: el routing key no se usa, todas las colas atadas reciben.
                template.convertAndSend(exchangePush, "", instrumentado);
                LOG.atLevel(nivelDe(instrumentado))
                        .log("push_publicado instancia={} destino={} consecutivo={} traceId={}",
                                instancia, instrumentado.destino(), instrumentado.consecutivo(),
                                instrumentado.traceId());
                return;
            } catch (AmqpException e) {
                // Degradación controlada: el broker no está, se entrega local.
                LOG.warn("push_degradado instancia={} destino={} consecutivo={} motivo={}",
                        instancia, instrumentado.destino(), instrumentado.consecutivo(),
                        e.getClass().getSimpleName());
            }
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
        // El traceId viaja con el mensaje: la instancia que entrega lo pone en su
        // MDC mientras empuja, así sus logs quedan correlacionados con el origen
        // aunque el evento haya nacido en otro nodo (T34).
        String traceAnterior = TraceId.actual();
        if (mensaje.traceId() != null) {
            TraceId.poner(mensaje.traceId());
        }
        try {
            Map<String, Object> cabeceras = cabecerasDe(mensaje);
            if (mensaje.usuario() != null) {
                messagingTemplate.convertAndSendToUser(
                        mensaje.usuario(), mensaje.destino(), mensaje.payload(), cabeceras);
            } else {
                messagingTemplate.convertAndSend(mensaje.destino(), mensaje.payload(), cabeceras);
            }
            Long milisegundos = milisegundosDesdeEmision(mensaje);
            medirPropagacion(mensaje, milisegundos);
            LOG.atLevel(nivelDe(mensaje))
                    .log("push_entregado instancia={} origen={} destino={} consecutivo={} propagacionMs={} traceId={}",
                            instancia, mensaje.instancia(), mensaje.destino(), mensaje.consecutivo(),
                            milisegundos, mensaje.traceId());
        } finally {
            if (traceAnterior != null) {
                TraceId.poner(traceAnterior);
            } else {
                TraceId.limpiar();
            }
        }
    }

    /**
     * Registra cuánto tardó el evento desde que se publicó hasta que esta
     * instancia lo entregó. Un mensaje sin {@code emitidoEn} (no instrumentado)
     * no se mide: no hay un instante de origen contra el cual comparar.
     */
    private void medirPropagacion(PushMessage mensaje, Long milisegundos) {
        if (registro == null || milisegundos == null) {
            return;
        }
        Timer.builder(METRICA_PROPAGACION)
                .description("Tiempo desde que se publica un evento hasta que se entrega a los clientes")
                .tag("origen", mensaje.instancia() != null ? mensaje.instancia() : "desconocido")
                .publishPercentileHistogram()
                .minimumExpectedValue(Duration.ofMillis(1))
                .maximumExpectedValue(Duration.ofSeconds(10))
                .register(registro)
                .record(milisegundos, TimeUnit.MILLISECONDS);
    }

    /**
     * Milisegundos desde la publicación, o {@code null} si el mensaje no trae un
     * {@code emitidoEn} válido. Los relojes de dos contenedores pueden diferir
     * unos milisegundos: un valor negativo se cuenta como 0 en vez de descartarse.
     */
    private static Long milisegundosDesdeEmision(PushMessage mensaje) {
        if (mensaje.emitidoEn() == null) {
            return null;
        }
        try {
            return Math.max(0L, System.currentTimeMillis() - Long.parseLong(mensaje.emitidoEn()));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** INFO para los eventos de negocio, DEBUG para la posición de la flota (T35). */
    private static Level nivelDe(PushMessage mensaje) {
        return DESTINO_ALTA_FRECUENCIA.equals(mensaje.destino()) ? Level.DEBUG : Level.INFO;
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
                instancia,
                mensaje.traceId() != null ? mensaje.traceId() : TraceId.actual());
    }

    private Map<String, Object> cabecerasDe(PushMessage mensaje) {
        Map<String, Object> cabeceras = new HashMap<>(5);
        if (mensaje.traceId() != null) {
            cabeceras.put(CABECERA_TRACE_ID, mensaje.traceId());
        }
        if (mensaje.emitidoEn() != null) {
            cabeceras.put(CABECERA_EMITIDO_EN, mensaje.emitidoEn());
            cabeceras.put(CABECERA_CONSECUTIVO, mensaje.consecutivo());
            cabeceras.put(CABECERA_INSTANCIA, mensaje.instancia());
        }
        return cabeceras;
    }
}
