package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Topología del broker para propagar eventos entre instancias (ADR-0009).
 *
 * <p>Un exchange <b>fanout</b> y una cola por instancia. Fanout es lo que hace
 * falta: el evento no se reparte entre consumidores, se replica a todos. Cada
 * instancia recibe una copia y la empuja a sus propias sesiones STOMP.
 *
 * <p>La cola es durable y lleva el identificador de la instancia en el nombre.
 * Durable importa: si la instancia se desconecta un momento, lo publicado en ese
 * hueco la espera en su cola en lugar de perderse. El nombre por instancia evita
 * que dos nodos compartan cola y se repartan los eventos a la mitad — que es
 * exactamente el fallo que este ADR corrige.
 *
 * <p>Todo el bloque queda detrás de {@code nexovital.eventos.broker.enabled}.
 * En desarrollo y en tests está apagado: una sola instancia no necesita broker y
 * la suite no debe depender de que haya uno corriendo.
 */
@Configuration
@ConditionalOnProperty(name = "nexovital.eventos.broker.enabled", havingValue = "true")
public class RabbitPropagacionConfig {

    /** Exchange por el que viajan todos los pushes de tiempo real. */
    @Bean
    public FanoutExchange exchangePush(
            @Value("${nexovital.push.exchange:nexovital.push}") String nombre) {
        return new FanoutExchange(nombre, /* durable */ true, /* autoDelete */ false);
    }

    /**
     * Cola exclusiva de esta instancia. El sufijo es el identificador de
     * instancia: con dos nodos hay dos colas y las dos reciben todos los eventos.
     */
    @Bean
    public Queue colaPush(
            @Value("${nexovital.push.exchange:nexovital.push}") String nombre,
            @Value("${nexovital.instancia-id:local}") String instanciaId) {
        return QueueBuilder.durable(nombre + "." + instanciaId).build();
    }

    /** Ata la cola de esta instancia al exchange: recibe todo lo que se publique. */
    @Bean
    public Binding bindingPush(Queue colaPush, FanoutExchange exchangePush) {
        return BindingBuilder.bind(colaPush).to(exchangePush);
    }

    /**
     * El payload es un objeto ya proyectado por el módulo dueño, sin tipo
     * conocido por el broker. JSON es el formato que no obliga a compartir clases
     * entre instancias y el mismo que el front ya consume.
     */
    @Bean
    public Jackson2JsonMessageConverter convertidorJsonPush() {
        return new Jackson2JsonMessageConverter();
    }
}
