package co.edu.escuelaing.nexovital.infrastructure.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * Reloj inyectable (diseño D8). La ventana de bloqueo de 5 minutos se calcula
 * con {@code Instant.now(clock)}, de modo que las pruebas puedan avanzar el
 * tiempo sin dormir la suite.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
