package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import com.fasterxml.jackson.databind.ObjectMapper;
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
 * Topología del fan-out de eventos entre instancias (ADR-0009).
 *
 * <p>Un exchange {@code fanout} entrega <b>una copia a cada cola atada</b>. Cada
 * instancia declara su propia cola con su identificador como sufijo, así que las
 * dos reciben todos los eventos y cada una se los entrega a sus propios clientes
 * conectados. Un exchange {@code direct} con una sola cola repartiría los eventos
 * entre consumidores en competencia y solo una instancia se enteraría.
 *
 * <p>Apagado por defecto: con una instancia no hay nada que propagar y la suite
 * no debe depender de que haya un broker corriendo.
 */
@Configuration
@ConditionalOnProperty(name = "nexovital.eventos.broker.enabled", havingValue = "true")
public class RabbitPropagacionConfig {

    /** Tiempo sin consumidor tras el cual RabbitMQ borra la cola de una instancia. */
    static final int COLA_SIN_CONSUMIDOR_MS = 120_000;

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
        // x-expires: si la cola pasa 2 minutos sin consumidor, RabbitMQ la borra.
        // En Azure cada réplica nueva tiene otro nombre; sin esto las colas de
        // réplicas muertas seguirían atadas al fanout acumulando mensajes hasta
        // llenar la memoria del broker. Un reinicio normal (menos de 2 minutos)
        // conserva la cola.
        return QueueBuilder.durable(nombre + "." + instanciaId)
                .expires(COLA_SIN_CONSUMIDOR_MS)
                .build();
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
     *
     * <p>Usa el {@link ObjectMapper} de Spring Boot, el mismo de la API REST. Un
     * {@code Jackson2JsonMessageConverter} sin argumentos crea su propio mapper,
     * que escribe un {@code Instant} como número ({@code 1.79E9}) y no como texto
     * ISO: el front descartaba el push de {@code /topic/emergencias} (su
     * {@code createdAt} dejaba de ser texto) y la emergencia solo aparecía al
     * refrescar. Con el mapper de Spring, el push y el REST serializan igual.
     */
    @Bean
    public Jackson2JsonMessageConverter convertidorJsonPush(ObjectMapper objectMapper) {
        return new Jackson2JsonMessageConverter(objectMapper);
    }
}
