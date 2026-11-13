package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarLlegadasVencidasUseCase;
import co.edu.escuelaing.nexovital.infrastructure.bloqueo.EjecucionUnica;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;

/** Periodic sweep that confirms arrivals the citizen did not answer in time. */
@Component
public class ConfirmacionAutomaticaScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(ConfirmacionAutomaticaScheduler.class);

    /** Stable lock name shared by every instance of the service. */
    private static final String BLOQUEO_CONFIRMACION = "confirmacion-llegadas";

    /** Validity longer than the 2 s interval so the owner renews in time. */
    private static final Duration VIGENCIA_BLOQUEO = Duration.ofSeconds(5);

    private final ConfirmarLlegadasVencidasUseCase confirmarLlegadasVencidasUseCase;
    private final EjecucionUnica ejecucionUnica;

    public ConfirmacionAutomaticaScheduler(ConfirmarLlegadasVencidasUseCase confirmarLlegadasVencidasUseCase,
                                           EjecucionUnica ejecucionUnica) {
        this.confirmarLlegadasVencidasUseCase = confirmarLlegadasVencidasUseCase;
        this.ejecucionUnica = ejecucionUnica;
    }

    @Scheduled(
            initialDelayString = "${nexovital.solicitud.confirmacion-automatica-delay-inicial-ms:0}",
            fixedDelayString = "${nexovital.solicitud.confirmacion-automatica-intervalo-ms:2000}")
    public void confirmarLlegadasVencidas() {
        // One instance at a time across the balancer (Sprint 2, T05).
        if (!ejecucionUnica.intentar(BLOQUEO_CONFIRMACION, VIGENCIA_BLOQUEO)) {
            return;
        }

        try {
            int confirmadas = confirmarLlegadasVencidasUseCase.confirmarVencidas();
            if (confirmadas > 0) {
                LOG.info("Llegadas confirmadas automáticamente: {}", confirmadas);
            }
        } catch (RuntimeException e) {
            // A transient failure must not stop the sweep; the next cycle retries.
            LOG.warn("Fallo al confirmar llegadas vencidas; se reintentará en el próximo ciclo", e);
        }
    }
}
