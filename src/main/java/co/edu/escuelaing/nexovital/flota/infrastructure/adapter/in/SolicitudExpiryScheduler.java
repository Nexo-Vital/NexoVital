package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Scheduled driver of the expiry use case (EP-04.F2.US9): the "temporizador del
 * servidor" the story asks for. It is the server, never the frontend, that
 * closes an unattended request.
 *
 * <p><b>Why {@code @Scheduled}.</b> The module had no scheduling idiom to reuse
 * and Spring's scheduling is already on the classpath ({@code spring-context},
 * pulled by {@code spring-boot-starter-web}), so no dependency is added. A
 * periodic sweep over the database is restart-safe and idempotent: an in-memory
 * per-request timer would be lost on restart and would let a request stay
 * PENDIENTE forever. The sweep is bounded and conditional, so it stays cheap and
 * cannot double-expire.
 *
 * <p>The initial delay and interval are configurable so the test profile can
 * disable the sweep and drive the use case directly.
 */
@Component
public class SolicitudExpiryScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(SolicitudExpiryScheduler.class);

    private final ExpirarSolicitudesVencidasUseCase expirarSolicitudesVencidasUseCase;

    public SolicitudExpiryScheduler(ExpirarSolicitudesVencidasUseCase expirarSolicitudesVencidasUseCase) {
        this.expirarSolicitudesVencidasUseCase = expirarSolicitudesVencidasUseCase;
    }

    @Scheduled(
            initialDelayString = "${nexovital.solicitud.expiracion-delay-inicial-ms:0}",
            fixedDelayString = "${nexovital.solicitud.expiracion-intervalo-ms:1000}")
    public void expirarSolicitudesVencidas() {
        try {
            int expiradas = expirarSolicitudesVencidasUseCase.expirarVencidas();
            if (expiradas > 0) {
                LOG.info("Solicitudes de ambulancia expiradas sin atender: {}", expiradas);
            }
        } catch (RuntimeException e) {
            // A transient DB failure must not kill the scheduler: it retries on
            // the next cycle. The conditional update makes the retry safe.
            LOG.warn("Fallo al expirar solicitudes vencidas; se reintentará en el próximo ciclo", e);
        }
    }
}
