package co.edu.escuelaing.nexovital.observabilidad.infrastructure;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.stereotype.Component;

/**
 * Métricas de negocio del tablero (ADR-0010).
 *
 * <p>Micrometer aporta gratis las métricas técnicas (JVM, HTTP, pool de
 * conexiones). Lo que no aporta es cuánto se usa el producto, y eso es lo que el
 * tablero de negocio tiene que mostrar.
 *
 * <p>Se instrumenta en el canal de push y no en cada caso de uso: todos los
 * módulos que producen algo visible para el usuario publican un
 * {@link PushMessage}, así que escuchar ese evento cuenta la actividad real sin
 * tocar un solo caso de uso. Es la misma lógica que el fan-out: un único punto
 * de paso.
 *
 * <p>El contador lleva el destino como etiqueta. Eso permite responder
 * «¿cuántas emergencias se propagaron?» filtrando por
 * {@code /topic/emergencias}, sin inventar una métrica por funcionalidad.
 */
@Component
public class MetricasNegocio {

    private static final String METRICA_EVENTOS = "nexovital.eventos.realtime";
    private static final String METRICA_USUARIOS = "nexovital.usuarios.stomp";

    private final MeterRegistry registro;

    public MetricasNegocio(MeterRegistry registro, SimpUserRegistry usuariosStomp) {
        this.registro = registro;
        // Gauge: cuántas sesiones STOMP hay abiertas ahora mismo. Es la métrica
        // de «operadores activos» que pide el tablero de negocio.
        Gauge.builder(METRICA_USUARIOS, usuariosStomp, SimpUserRegistry::getUserCount)
                .description("Sesiones STOMP autenticadas abiertas en esta instancia")
                .register(registro);
    }

    /** Cada evento que se propaga a los clientes cuenta, etiquetado por destino. */
    @EventListener
    public void alPublicarPush(PushMessage mensaje) {
        Counter.builder(METRICA_EVENTOS)
                .description("Eventos de tiempo real propagados a los clientes")
                .tag("destino", mensaje.destino())
                .register(registro)
                .increment();
    }
}
