package co.edu.escuelaing.nexovital.infrastructure.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables Spring's scheduled tasks. The fleet module's expiry sweep
 * ({@code SolicitudExpiryScheduler}) is the only member: it closes the
 * ambulance requests nobody attended within their window (EP-04.F2.US9).
 *
 * <p>{@code @Scheduled} and {@code @EnableScheduling} ship with
 * {@code spring-context}, already on the classpath: no new dependency.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
