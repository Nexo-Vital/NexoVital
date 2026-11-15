package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * El push por RabbitMQ debe serializar un {@code Instant} como texto ISO, igual
 * que la API REST: con un mapper propio salía como número y el front descartaba
 * el evento de {@code /topic/emergencias}.
 */
class RabbitPropagacionConfigTest {

    @Test
    void elConvertidorEscribeLasFechasComoTextoIso() {
        ObjectMapper mapperDeSpring = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        Jackson2JsonMessageConverter convertidor =
                new RabbitPropagacionConfig().convertidorJsonPush(mapperDeSpring);

        Message mensaje = convertidor.toMessage(
                Map.of("createdAt", Instant.parse("2026-11-14T10:00:00Z")), new MessageProperties());
        String cuerpo = new String(mensaje.getBody(), StandardCharsets.UTF_8);

        assertTrue(cuerpo.contains("2026-11-14T10:00:00Z"), "la fecha debe viajar como texto ISO: " + cuerpo);
    }
}
