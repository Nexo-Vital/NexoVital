package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.DetectarSenalPerdidaUseCase;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Scheduled driver of the signal-loss sweep (EP-04.F1.US1, scenario 4, design
 * D5). It is the server, never the frontend, that decides a unit lost its
 * signal, so every connected user sees the same thing.
 *
 * <p><b>Why a periodic sweep.</b> Same idiom as {@code SolicitudExpiryScheduler}:
 * a sweep over the database is restart-safe and idempotent, while an in-memory
 * timer per unit would be lost on restart. The sweep is a conditional update, so
 * it stays cheap and cannot mark a unit twice.
 *
 * <p>With the default interval (1 s) a unit is marked between 30 and 31 seconds
 * after its last report. The initial delay and the interval are configurable so
 * the test profile can disable the sweep and drive the use case directly.
 */
@Component
public class SenalFlotaScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(SenalFlotaScheduler.class);

    private final DetectarSenalPerdidaUseCase detectarSenalPerdidaUseCase;

    public SenalFlotaScheduler(DetectarSenalPerdidaUseCase detectarSenalPerdidaUseCase) {
        this.detectarSenalPerdidaUseCase = detectarSenalPerdidaUseCase;
    }

    @Scheduled(
            initialDelayString = "${nexovital.flota.senal.delay-inicial-ms:5000}",
            fixedDelayString = "${nexovital.flota.senal.intervalo-ms:1000}")
    public void detectarSenalPerdida() {
        try {
            int marcadas = detectarSenalPerdidaUseCase.detectar();
            if (marcadas > 0) {
                LOG.info("Ambulancias marcadas sin señal: {}", marcadas);
            }
        } catch (RuntimeException e) {
            // A transient DB failure must not kill the scheduler: it retries on
            // the next cycle. The conditional update makes the retry safe.
            LOG.warn("Fallo al detectar ambulancias sin señal; se reintentará en el próximo ciclo", e);
        }
    }
}
