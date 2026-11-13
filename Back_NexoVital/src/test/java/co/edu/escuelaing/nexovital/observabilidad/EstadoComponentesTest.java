package co.edu.escuelaing.nexovital.observabilidad;

import co.edu.escuelaing.nexovital.observabilidad.infrastructure.EstadoComponentes;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Sprint 2, T38/T39: el estado de cada componente se publica como 1/0 y una
 * comprobación colgada se marca como caída en el tiempo límite, sin esperar los
 * 30 s del pool de conexiones.
 */
class EstadoComponentesTest {

    private final SimpleMeterRegistry registro = new SimpleMeterRegistry();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<RabbitTemplate> rabbit = mock(ObjectProvider.class);
    private EstadoComponentes estado;

    @AfterEach
    void cerrar() {
        if (estado != null) {
            estado.destroy();
        }
    }

    @Test
    @DisplayName("antes de la primera comprobación no hay estado inventado")
    void sinComprobarEsNaN() {
        estado = new EstadoComponentes(registro, jdbc, rabbit, false, 5000);

        assertTrue(Double.isNaN(gauge("base_datos")));
    }

    @Test
    @DisplayName("la base que responde se publica como 1")
    void baseDisponible() {
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1);
        estado = new EstadoComponentes(registro, jdbc, rabbit, false, 5000);

        estado.verificarAhora();

        assertEquals(1.0, gauge("base_datos"));
    }

    @Test
    @DisplayName("la base que falla se publica como 0")
    void baseCaida() {
        when(jdbc.queryForObject("SELECT 1", Integer.class))
                .thenThrow(new CannotGetJdbcConnectionException("conexión rechazada"));
        estado = new EstadoComponentes(registro, jdbc, rabbit, false, 5000);

        estado.verificarAhora();

        assertEquals(0.0, gauge("base_datos"));
    }

    @Test
    @DisplayName("T39: una comprobación colgada se marca caída en el tiempo límite")
    void baseColgadaSeMarcaCaidaSinEsperar() {
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenAnswer(invocacion -> {
            Thread.sleep(10_000);
            return 1;
        });
        estado = new EstadoComponentes(registro, jdbc, rabbit, false, 5000);

        long inicio = System.nanoTime();
        estado.verificarAhora();
        long milisegundos = (System.nanoTime() - inicio) / 1_000_000;

        assertEquals(0.0, gauge("base_datos"));
        assertTrue(milisegundos < 5_000, "no debe esperar a que la consulta termine: " + milisegundos + " ms");
    }

    @Test
    @DisplayName("sin broker no se publica la serie de RabbitMQ")
    void sinBrokerNoHaySerieDeRabbit() {
        estado = new EstadoComponentes(registro, jdbc, rabbit, false, 5000);

        assertNull(registro.find("nexovital.componente.disponible").tag("componente", "rabbitmq").gauge());
    }

    @Test
    @DisplayName("con broker, si RabbitMQ no está disponible se publica 0")
    void rabbitCaido() {
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1);
        when(rabbit.getIfAvailable()).thenReturn(null);
        estado = new EstadoComponentes(registro, jdbc, rabbit, true, 5000);

        estado.verificarAhora();

        assertEquals(1.0, gauge("base_datos"));
        assertEquals(0.0, gauge("rabbitmq"));
    }

    private double gauge(String componente) {
        return registro.get("nexovital.componente.disponible").tag("componente", componente).gauge().value();
    }
}
